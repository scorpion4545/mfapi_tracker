# Taskdesk

A team task tracker: deadlines, assignees, progress, notes, attached Google Sheets, and a hub that merges several sheets (CSV/Excel uploads) into one.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole website |
| `config.js` | Your Supabase URL and anon key |
| `backend.js` | Supabase sign-in and data storage |
| `schema.sql` | Database setup, run once in Supabase |

## Set up Supabase (one time)

1. In Supabase, open **SQL Editor → New query**. Paste `schema.sql`, change `you@example.com` at the bottom to your team's emails (lowercase), and click **Run**.
2. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `config.js`. Never use the `service_role` key.
3. Optional: under **Authentication → Providers → Email**, turn off "Confirm email" if you don't want people to confirm by email before their first sign-in.

Only emails in the `taskdesk_members` table can see or change data. To add someone later, run:

```sql
insert into public.taskdesk_members (email) values ('new.person@company.com');
```

## Run it locally

```bash
python -m http.server 8765
```

Then open http://127.0.0.1:8765. With `config.js` left empty, it runs in local mode and saves to your browser only.

## Put it online

It's a static site, so any static host works. Upload this folder to Netlify (drag and drop at app.netlify.com/drop), Vercel, or GitHub Pages. Then, in Supabase, add the site's address under **Authentication → URL Configuration → Site URL** so confirmation emails link back to it.
