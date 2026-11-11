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

-- 4. Add your team's emails (lowercase). Edit and run this line again whenever someone joins.
insert into public.taskdesk_members (email) values
  ('you@example.com')
on conflict do nothing;
