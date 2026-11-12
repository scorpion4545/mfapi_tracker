"""Apply schema.sql to the Taskdesk Supabase database and add team emails.

Reads the connection string from the TASKDESK_DB_URL line in .env (this folder).
Never prints the password.

    python apply_schema.py you@gmail.com teammate@company.com
"""
import pathlib
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
    print("Team members:", ", ".join(members))
    print("Live updates enabled:", realtime)


if __name__ == "__main__":
    main()
