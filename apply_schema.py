"""Apply schema.sql to the Taskdesk Supabase database and add team emails.

Reads the connection string from the TASKDESK_DB_URL line in .env (this folder).
Never prints the password.

    python apply_schema.py you@gmail.com teammate@company.com
"""
import pathlib
import random
import re
import sys

import psycopg2

HERE = pathlib.Path(__file__).parent


def db_url() -> str:
    env = HERE / ".env"
    if not env.exists():
        sys.exit("Create .env in this folder with: TASKDESK_DB_URL=postgresql://...")
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("TASKDESK_DB_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("TASKDESK_DB_URL not found in .env")


def main() -> None:
    args = sys.argv[1:]
    admins = []
    while "--admin" in args:  # --admin someone@x.com : add as a member who can approve requests
        i = args.index("--admin")
        admins.append(args[i + 1].strip().lower())
        del args[i:i + 2]
    emails = [e.strip().lower() for e in args if e.strip()] + admins
    bad = [e for e in emails if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", e)]
    if bad:
        sys.exit(f"Not valid emails: {bad}")

    sql = (HERE / "schema.sql").read_text(encoding="utf-8")
    sql = sql.split("-- 4. Add your team's emails")[0]  # placeholder insert handled below

    url = db_url()
    conn = psycopg2.connect(url, sslmode="require", connect_timeout=15)
    host = re.sub(r"//[^@]*@", "//***@", url)
    print(f"Connected to {host}")
    try:
        with conn, conn.cursor() as cur:
            cur.execute(sql)
            cur.executemany(
                "insert into public.taskdesk_members (email) values (%s) on conflict do nothing",
                [(e,) for e in emails],
            )
            if admins:
                cur.execute("update public.taskdesk_members set is_admin = true where email = any(%s)", (admins,))
            # Give every existing task without a ticket number one (W-1234). Safe to run repeatedly.
            tickets_added = 0
            cur.execute("select id, data->>'ticket' from public.taskdesk_docs where collection = 'tasks'")
            rows = cur.fetchall()
            used = {t.upper() for _, t in rows if t}
            for doc_id, t in rows:
                if t:
                    continue
                while True:
                    ticket = f"W-{random.randint(1000, 9999)}" if len(used) < 6000 else f"W-{random.randint(10000, 99999)}"
                    if ticket not in used:
                        break
                used.add(ticket)
                cur.execute(
                    "update public.taskdesk_docs set data = data || jsonb_build_object('ticket', %s::text) "
                    "where collection = 'tasks' and id = %s",
                    (ticket, doc_id),
                )
                tickets_added += 1
            cur.execute("notify pgrst, 'reload schema'")
            cur.execute("select email, is_admin from public.taskdesk_members order by email")
            members = [r[0] + (" (admin)" if r[1] else "") for r in cur.fetchall()]
            cur.execute(
                "select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='taskdesk_docs'"
            )
            realtime = cur.fetchone()[0] == 1
    finally:
        conn.close()
    print("Schema applied.")
    print(f"Ticket numbers added to {tickets_added} existing tasks.")
    print("Team members:", ", ".join(members))
    print("Live updates enabled:", realtime)


if __name__ == "__main__":
    main()
