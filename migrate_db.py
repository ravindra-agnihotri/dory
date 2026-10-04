"""
One-off: copy the website's text content (and version history) from one Postgres database
to another, e.g. Neon -> Supabase. Photos are in Cloudinary and don't need moving.

    python3 migrate_db.py "OLD_DATABASE_URL" "NEW_DATABASE_URL"

Safe to re-run: it replaces the content in the new database with the old one's.
"""
import sys

import psycopg
from psycopg.types.json import Jsonb


def main(old_url, new_url):
    with psycopg.connect(old_url, prepare_threshold=None) as old, old.cursor() as cur:
        cur.execute("SELECT data FROM site_content WHERE id = 1")
        row = cur.fetchone()
        if not row:
            sys.exit("The old database has no saved content yet, so there's nothing to copy.")
        content = row[0]
        cur.execute("SELECT data, saved_at FROM content_history ORDER BY id")
        history = cur.fetchall()

    # Creates the tables (with row-level security) exactly as the app does.
    import os
    os.environ.setdefault("ADMIN_PASSWORD", "migration")
    os.environ["DATABASE_URL"] = new_url
    from app import DBStore
    DBStore(new_url).conn().close()

    with psycopg.connect(new_url, prepare_threshold=None) as new, new.cursor() as cur:
        cur.execute("""INSERT INTO site_content (id, data, updated_at) VALUES (1, %s, now())
                       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()""",
                    (Jsonb(content),))
        cur.execute("DELETE FROM content_history")
        for data, saved_at in history:
            cur.execute("INSERT INTO content_history (data, saved_at) VALUES (%s, %s)", (Jsonb(data), saved_at))
    print(f"Copied the content and {len(history)} previous versions. Bakery name: {content.get('name')}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
