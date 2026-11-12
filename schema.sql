-- Taskdesk: run this once in Supabase -> SQL Editor -> New query -> Run.

-- 1. Who may use the workspace. Only these emails can read or change data.
create table if not exists public.taskdesk_members (
  email text primary key,
  added_at timestamptz not null default now()
);
alter table public.taskdesk_members enable row level security;

-- Checks the signed-in user's email against the list (security definer avoids RLS recursion).
create or replace function public.taskdesk_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.taskdesk_members where email = lower(auth.jwt() ->> 'email'));
$$;

-- Members can see the member list (nobody can change it from the website;
-- add or remove people here in the SQL editor or the Table Editor).
drop policy if exists "members read members" on public.taskdesk_members;
create policy "members read members" on public.taskdesk_members
  for select to authenticated using (public.taskdesk_is_member());

-- 2. All workspace data (tasks, team) as JSON documents.
create table if not exists public.taskdesk_docs (
  collection text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (collection, id)
);
alter table public.taskdesk_docs enable row level security;

drop policy if exists "members read docs" on public.taskdesk_docs;
drop policy if exists "members insert docs" on public.taskdesk_docs;
drop policy if exists "members update docs" on public.taskdesk_docs;
drop policy if exists "members delete docs" on public.taskdesk_docs;
create policy "members read docs"   on public.taskdesk_docs for select to authenticated using (public.taskdesk_is_member());
create policy "members insert docs" on public.taskdesk_docs for insert to authenticated with check (public.taskdesk_is_member());
create policy "members update docs" on public.taskdesk_docs for update to authenticated using (public.taskdesk_is_member()) with check (public.taskdesk_is_member());
create policy "members delete docs" on public.taskdesk_docs for delete to authenticated using (public.taskdesk_is_member());

-- 3. Live updates between teammates.
do $$ begin
  alter publication supabase_realtime add table public.taskdesk_docs;
exception when duplicate_object then null; end $$;

-- 3b. Admins and access requests.
-- A new person signs in, fills in a request, and waits. An admin approves or rejects it on the Team page.
alter table public.taskdesk_members add column if not exists is_admin boolean not null default false;
alter table public.taskdesk_members add column if not exists name text;

create or replace function public.taskdesk_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.taskdesk_members where email = lower(auth.jwt() ->> 'email') and is_admin);
$$;

create table if not exists public.taskdesk_requests (
  user_id uuid primary key default auth.uid(),
  email text not null,
  name text not null,
  role text,
  phone text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);
alter table public.taskdesk_requests enable row level security;

-- People see only their own request; admins see all. Nobody edits a request directly:
-- decisions go through the functions below.
drop policy if exists "own or admin read requests" on public.taskdesk_requests;
drop policy if exists "insert own pending request" on public.taskdesk_requests;
create policy "own or admin read requests" on public.taskdesk_requests
  for select to authenticated using (user_id = auth.uid() or public.taskdesk_is_admin());
create policy "insert own pending request" on public.taskdesk_requests
  for insert to authenticated
  with check (user_id = auth.uid() and email = lower(auth.jwt() ->> 'email') and status = 'pending' and decided_at is null);

create or replace function public.taskdesk_decide_request(req_user uuid, approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.taskdesk_requests;
begin
  if not public.taskdesk_is_admin() then raise exception 'Only an admin can do this' using errcode = '42501'; end if;
  select * into r from public.taskdesk_requests where user_id = req_user;
  if not found then raise exception 'Request not found'; end if;
  if approve then
    insert into public.taskdesk_members (email, name) values (lower(r.email), r.name) on conflict (email) do nothing;
  else
    delete from public.taskdesk_members where email = lower(r.email) and not is_admin;
  end if;
  update public.taskdesk_requests
     set status = case when approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = lower(auth.jwt() ->> 'email')
   where user_id = req_user;
end $$;

create or replace function public.taskdesk_remove_member(member_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.taskdesk_is_admin() then raise exception 'Only an admin can do this' using errcode = '42501'; end if;
  delete from public.taskdesk_members where email = lower(member_email) and not is_admin;
  update public.taskdesk_requests set status = 'rejected', decided_at = now(), decided_by = lower(auth.jwt() ->> 'email')
   where lower(email) = lower(member_email) and status = 'approved';
end $$;

revoke execute on function public.taskdesk_decide_request(uuid, boolean) from public, anon;
revoke execute on function public.taskdesk_remove_member(text) from public, anon;
grant execute on function public.taskdesk_decide_request(uuid, boolean) to authenticated;
grant execute on function public.taskdesk_remove_member(text) to authenticated;

-- 4. Add your team's emails (lowercase). Edit and run this line again whenever someone joins.
insert into public.taskdesk_members (email) values
  ('you@example.com')
on conflict do nothing;
