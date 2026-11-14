#!/usr/bin/env python3
"""Duelette admin commands. Run them on the server, next to the database.

  python3 admin.py codes 10 --days 30   make 10 one-time Pro codes, each worth 30 days
  python3 admin.py grant NAME 30        give NAME 30 days of Pro
  python3 admin.py revoke NAME          end NAME's Pro now
  python3 admin.py stats                accounts, Pro members and games played today
  python3 admin.py backup               copy the database into ./backups (keeps the newest 28)
  python3 admin.py import-v1 FILE       bring players and duels over from the first version's database
  python3 admin.py reset-password NAME  give NAME a temporary password (owner lost their browser)

Set DATA_DIR if the database is not in ./data (on xixi: ~/duelette-srv/data, the default).
"""
import argparse
import os
import time

from accounts import Store, today

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(HERE, "data"))


def main():
    parser = argparse.ArgumentParser(description="Duelette admin")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("codes", help="make one-time Pro codes")
    p.add_argument("count", type=int)
    p.add_argument("--days", type=int, default=30)
    p = sub.add_parser("grant", help="give an account Pro days")
    p.add_argument("name")
    p.add_argument("days", type=int)
    p = sub.add_parser("revoke", help="end an account's Pro")
    p.add_argument("name")
    sub.add_parser("stats", help="show totals")
    sub.add_parser("backup", help="back up the database")
    p = sub.add_parser("import-v1", help="import the first version's players and duels")
    p.add_argument("file")
    p = sub.add_parser("reset-password", help="give an account a temporary password")
    p.add_argument("name")
    args = parser.parse_args()

    store = Store(os.path.join(DATA_DIR, "duelette2.db"))
    if args.cmd == "codes":
        for code in store.create_codes(max(1, min(500, args.count)), args.days):
            print(code)
    elif args.cmd == "grant":
        until = store.grant(args.name.lower(), args.days)
        print("No account named %s" % args.name if until is None else "%s has Pro until %s" % (args.name, time.strftime("%Y-%m-%d", time.gmtime(until))))
    elif args.cmd == "backup":
        print(store.backup(os.path.join(HERE, "backups")))
    elif args.cmd == "import-v1":
        import sqlite3
        old = sqlite3.connect(args.file)
        old.row_factory = sqlite3.Row
        added, games = store.import_legacy([dict(r) for r in old.execute("SELECT * FROM players")],
                                           [dict(r) for r in old.execute("SELECT * FROM matches")])
        print("imported players:", added or "none new", "| duels:", games)
    elif args.cmd == "reset-password":
        temp = store.reset_password(args.name.lower())
        print("No account named %s" % args.name if temp is None else "Temporary password for %s: %s (ask them to keep it or recover later)" % (args.name, temp))
    elif args.cmd == "revoke":
        with store.lock:
            n = store.db.execute("UPDATE accounts SET pro_until = 0 WHERE key = ?", (args.name.lower(),)).rowcount
            store.db.commit()
        print("Revoked" if n else "No account named %s" % args.name)
    else:
        day, _ = today()
        db = store.db
        q = lambda sql, *a: db.execute(sql, a).fetchone()[0]
        print("accounts        ", q("SELECT COUNT(*) FROM accounts"))
        print("pro members     ", q("SELECT COUNT(*) FROM accounts WHERE pro_until > ?", time.time()))
        print("games today     ", q("SELECT COALESCE(SUM(count), 0) FROM plays WHERE day = ?", day))
        print("players today   ", q("SELECT COUNT(*) FROM plays WHERE day = ?", day))
        print("hit the limit   ", q("SELECT COUNT(*) FROM plays WHERE day = ? AND count >= 3", day))
        print("codes unused    ", q("SELECT COUNT(*) FROM pro_codes WHERE used_by IS NULL"))


if __name__ == "__main__":
    main()
