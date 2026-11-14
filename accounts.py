"""Accounts, sessions, plans, rankings and learning progress, stored in SQLite.

A name is a real account: 3 to 16 letters, digits or underscores, unique ignoring case,
protected by a password (salted PBKDF2) and a one-time recovery code shown at sign-up.

Guests can play without signing up: a guest is an account with a random key that cannot
be typed as a name, no password and no place on the world ranking. Duels involving a guest
do not change ratings. A guest can save their progress by picking a name and password,
which turns the guest account into a normal one and keeps everything it earned.

Free accounts get FREE_GAMES games a day; Pro accounts are unlimited. Pro comes from a
Lemon Squeezy subscription (see billing.py) or from one-time codes (see admin.py).

Every trivia and estimation question has a difficulty rating, and every player has a
rating per topic. Both move like chess ratings after each answer. The game uses them to
pick questions a player gets right about 65% of the time, and the profile turns them into
mastery: the chance of answering a typical question in that topic.
"""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta

NAME_RE = re.compile(r"^[A-Za-z0-9_]{3,16}$")
RESERVED = {"admin", "administrator", "duelette", "system", "server", "moderator", "mod", "support",
            "null", "undefined", "guest", "anonymous", "root", "staff", "official"}
AVATAR_RE = re.compile(r"^c[0-7]$")
ROUNDS = 200_000
SESSION_TTL = 180 * 86400
START_RATING = 1000.0
K = 32
SIGNUPS_PER_HOUR = 200
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
FREE_GAMES = int(os.environ.get("DUELETTE_FREE_GAMES", "3"))
# Days (free games, streaks, the Daily Duel) follow US Eastern time, where the players are.
DAY_TZ = os.environ.get("DUELETTE_TZ", "America/New_York")
try:
    from zoneinfo import ZoneInfo
    _TZ = ZoneInfo(DAY_TZ)
except Exception:  # no time zone database: fall back to a fixed offset
    _TZ = None
DAY_OFFSET = -5 * 3600
LAUNCH_DAY = date(2026, 11, 14)  # Daily Duel #1
ITEM_K = 12
GUESTS_PER_IP_PER_DAY = 12
GUESTS_PER_HOUR = 600
SUB_GRACE = 2 * 86400
RENAME_COOLDOWN = 7 * 86400  # one name change a week keeps the world ranking readable  # keep Pro for 2 days past a renewal date while the payment goes through


def _pw_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ROUNDS)


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _code(groups):
    raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(4 * groups))
    return "-".join(raw[i:i + 4] for i in range(0, len(raw), 4))


def _norm_code(code):
    return re.sub(r"[^A-Z0-9]", "", str(code).upper())


def _expected(player, item):
    return 1.0 / (1.0 + 10 ** ((item - player) / 400.0))


def today(now=None):
    """The current day label and the moment it ends, in the configured time zone."""
    now = now or time.time()
    if _TZ:
        dt = datetime.fromtimestamp(now, _TZ)
        start = dt.replace(hour=0, minute=0, second=0, microsecond=0)
        return dt.strftime("%Y-%m-%d"), (start + timedelta(days=1)).timestamp()
    t = now + DAY_OFFSET
    day_start = t - (t % 86400)
    return time.strftime("%Y-%m-%d", time.gmtime(t)), day_start + 86400 - DAY_OFFSET


def daily_number(day):
    return (date.fromisoformat(day) - LAUNCH_DAY).days + 1


class Store:
    def __init__(self, path, item_topics=None, topic_names=None):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.fails = {}
        self.signups = []
        self.item_topics = item_topics or {}
        self.topic_names = topic_names or {}
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (
              key TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT 'c0',
              pass_salt BLOB NOT NULL, pass_hash BLOB NOT NULL, recovery_hash TEXT NOT NULL,
              rating REAL NOT NULL DEFAULT 1000, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
              ties INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0,
              solo_best INTEGER NOT NULL DEFAULT 0, solo_runs INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY, key TEXT NOT NULL, created REAL NOT NULL, seen REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS games (
              id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, mode TEXT NOT NULL,
              a TEXT NOT NULL, b TEXT, score_a INTEGER NOT NULL, score_b INTEGER,
              delta_a REAL, delta_b REAL, forfeit INTEGER
            );
            CREATE TABLE IF NOT EXISTS plays (key TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (key, day));
            CREATE TABLE IF NOT EXISTS pro_codes (
              code_hash TEXT PRIMARY KEY, days INTEGER NOT NULL, created REAL NOT NULL, used_by TEXT, used_at REAL
            );
            CREATE TABLE IF NOT EXISTS item_stats (id TEXT PRIMARY KEY, rating REAL NOT NULL, attempts INTEGER NOT NULL, score REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS topic_ratings (
              key TEXT NOT NULL, topic TEXT NOT NULL, rating REAL NOT NULL, answers INTEGER NOT NULL, baseline INTEGER,
              PRIMARY KEY (key, topic)
            );
            CREATE TABLE IF NOT EXISTS seen (key TEXT NOT NULL, item TEXT NOT NULL, ts REAL NOT NULL, PRIMARY KEY (key, item));
            """
        )
        cols = {r["name"] for r in self.db.execute("PRAGMA table_info(accounts)")}
        for name, ddl in (("pro_until", "REAL NOT NULL DEFAULT 0"), ("guest", "INTEGER NOT NULL DEFAULT 0"),
                          ("sub_id", "TEXT"), ("sub_status", "TEXT"), ("sub_until", "REAL NOT NULL DEFAULT 0"),
                          ("legacy_hash", "TEXT"), ("renamed_at", "REAL NOT NULL DEFAULT 0"),
                          ("streak", "INTEGER NOT NULL DEFAULT 0"), ("streak_day", "TEXT"),
                          ("best_streak", "INTEGER NOT NULL DEFAULT 0"), ("freeze_week", "TEXT")):
            if name not in cols:
                self.db.execute("ALTER TABLE accounts ADD COLUMN %s %s" % (name, ddl))
        self.db.execute("CREATE TABLE IF NOT EXISTS checkouts (ref TEXT PRIMARY KEY, key TEXT NOT NULL, created REAL NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS daily_scores (day TEXT NOT NULL, key TEXT NOT NULL, score INTEGER NOT NULL, "
                        "ts REAL NOT NULL, PRIMARY KEY (day, key))")
        self.db.commit()
        self.guest_log = []

    # ---------------------------------------------------------- accounts

    def _session(self, key):
        token = secrets.token_urlsafe(32)
        now = time.time()
        self.db.execute("INSERT INTO sessions (token_hash, key, created, seen) VALUES (?, ?, ?, ?)", (_sha(token), key, now, now))
        self.db.commit()
        return token

    def register(self, name, password, avatar):
        """Returns (profile, token, recovery_code) or (None, error, None)."""
        name = name.strip() if isinstance(name, str) else ""
        if not NAME_RE.match(name):
            return None, "bad_name", None
        if name.lower() in RESERVED or name.lower().startswith("guest"):
            return None, "reserved", None
        if not isinstance(password, str) or not 6 <= len(password) <= 128:
            return None, "weak_password", None
        salt = os.urandom(16)
        digest = _pw_hash(password, salt)
        recovery = _code(4)
        now = time.time()
        with self.lock:
            self.signups = [t for t in self.signups if now - t < 3600]
            if len(self.signups) >= SIGNUPS_PER_HOUR:
                return None, "busy", None
            if self.db.execute("SELECT 1 FROM accounts WHERE key = ?", (name.lower(),)).fetchone():
                return None, "taken", None
            self.db.execute(
                "INSERT INTO accounts (key, name, avatar, pass_salt, pass_hash, recovery_hash, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (name.lower(), name, avatar if AVATAR_RE.match(avatar or "") else "c0", salt, digest,
                 _sha(_norm_code(recovery)), now))
            self.db.commit()
            self.signups.append(now)
            token = self._session(name.lower())
            return self.profile(name.lower()), token, recovery

    def create_guest(self, ip, avatar):
        """Make a guest account and session. Returns (profile, token) or (None, error)."""
        now = time.time()
        with self.lock:
            self.guest_log = [(t, a) for t, a in self.guest_log if now - t < 86400]
            if sum(1 for t, _ in self.guest_log if now - t < 3600) >= GUESTS_PER_HOUR:
                return None, "busy"
            if ip and sum(1 for _, a in self.guest_log if a == ip) >= GUESTS_PER_IP_PER_DAY:
                return None, "busy"
            for _ in range(20):
                key = "~" + "".join(secrets.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(10))
                name = "Guest%04d" % secrets.randbelow(10000)
                if not self.db.execute("SELECT 1 FROM accounts WHERE key = ?", (key,)).fetchone():
                    break
            self.db.execute("INSERT INTO accounts (key, name, avatar, pass_salt, pass_hash, recovery_hash, created, guest) "
                            "VALUES (?, ?, ?, ?, ?, '', ?, 1)",
                            (key, name, avatar if AVATAR_RE.match(avatar or "") else "c0", b"", b"", now))
            self.db.commit()
            self.guest_log.append((now, ip))
            return self.profile(key), self._session(key)

    def upgrade_guest(self, key, name, password):
        """Turn a guest into a named account, keeping its progress. Returns (profile, recovery) or (None, error)."""
        name = name.strip() if isinstance(name, str) else ""
        if not NAME_RE.match(name):
            return None, "bad_name"
        if name.lower() in RESERVED or name.lower().startswith("guest"):
            return None, "reserved"
        if not isinstance(password, str) or not 6 <= len(password) <= 128:
            return None, "weak_password"
        salt = os.urandom(16)
        digest = _pw_hash(password, salt)
        recovery = _code(4)
        new = name.lower()
        with self.lock:
            row = self.db.execute("SELECT guest FROM accounts WHERE key = ?", (key,)).fetchone()
            if not row or not row["guest"]:
                return None, "not_guest"
            if self.db.execute("SELECT 1 FROM accounts WHERE key = ?", (new,)).fetchone():
                return None, "taken"
            self.db.execute("UPDATE accounts SET key = ?, name = ?, pass_salt = ?, pass_hash = ?, recovery_hash = ?, guest = 0 WHERE key = ?",
                            (new, name, salt, digest, _sha(_norm_code(recovery)), key))
            for table, col in (("sessions", "key"), ("plays", "key"), ("topic_ratings", "key"), ("seen", "key"),
                               ("checkouts", "key"), ("daily_scores", "key"), ("games", "a"), ("games", "b")):
                self.db.execute("UPDATE %s SET %s = ? WHERE %s = ?" % (table, col, col), (new, key))
            self.db.commit()
            return self.profile(new), recovery

    # ---------------------------------------------------------- streaks and the Daily Duel

    def touch_streak(self, key):
        """Count today for the streak after a finished game. Pro saves one missed day a week."""
        day, _ = today()
        d = date.fromisoformat(day)
        week = "%d-W%02d" % d.isocalendar()[:2]
        pro = self.is_pro(key)
        with self.lock:
            r = self.db.execute("SELECT streak, streak_day, best_streak, freeze_week, guest FROM accounts WHERE key = ?", (key,)).fetchone()
            if not r:
                return None
            last = date.fromisoformat(r["streak_day"]) if r["streak_day"] else None
            if last == d:
                return {"count": r["streak"], "best": r["best_streak"], "extended": False, "saved": False}
            saved = False
            freeze_week = r["freeze_week"]
            if last == d - timedelta(days=1):
                count = r["streak"] + 1
            elif last == d - timedelta(days=2) and pro and r["freeze_week"] != week:
                count, saved, freeze_week = r["streak"] + 1, True, week
            else:
                count = 1
            best = max(r["best_streak"], count)
            self.db.execute("UPDATE accounts SET streak = ?, streak_day = ?, best_streak = ?, freeze_week = ? WHERE key = ?",
                            (count, day, best, freeze_week, key))
            self.db.commit()
            return {"count": count, "best": best, "extended": True, "saved": saved}

    def _streak_view(self, r, pro):
        d = date.fromisoformat(today()[0])
        if not r["streak_day"]:
            return {"count": 0, "best": r["best_streak"], "today": False, "atRisk": False}
        gap = (d - date.fromisoformat(r["streak_day"])).days
        week = "%d-W%02d" % d.isocalendar()[:2]
        alive = gap <= 1 or (gap == 2 and pro and r["freeze_week"] != week)
        return {"count": r["streak"] if alive else 0, "best": r["best_streak"], "today": gap == 0,
                "atRisk": alive and gap > 0, "freeze": gap == 2 and alive}

    def daily_done(self, key):
        with self.lock:
            return bool(self.db.execute("SELECT 1 FROM daily_scores WHERE day = ? AND key = ?", (today()[0], key)).fetchone())

    def daily_status(self, key):
        day, reset_at = today()
        with self.lock:
            row = self.db.execute("SELECT score FROM daily_scores WHERE day = ? AND key = ?", (day, key)).fetchone()
            players = self.db.execute("SELECT COUNT(*) FROM daily_scores d JOIN accounts a ON a.key = d.key "
                                      "WHERE d.day = ? AND a.guest = 0", (day,)).fetchone()[0]
            out = {"day": day, "num": daily_number(day), "done": bool(row), "resetAt": reset_at, "players": players}
            if row:
                guest = self.db.execute("SELECT guest FROM accounts WHERE key = ?", (key,)).fetchone()["guest"]
                out["score"] = row["score"]
                out["rank"] = None if guest else self.db.execute(
                    "SELECT COUNT(*) + 1 FROM daily_scores d JOIN accounts a ON a.key = d.key "
                    "WHERE d.day = ? AND a.guest = 0 AND d.score > ?", (day, row["score"])).fetchone()[0]
            return out

    def apply_daily(self, key, day, score):
        with self.lock:
            self.db.execute("INSERT OR IGNORE INTO daily_scores (day, key, score, ts) VALUES (?, ?, ?, ?)", (day, key, score, time.time()))
            self.db.commit()
        return self.daily_status(key)

    # ---------------------------------------------------------- changing a name

    def rename(self, key, name, password):
        """Change a logged-in account's name, keeping everything it owns.

        Returns (profile, None, None) or (None, error, next_allowed_time). Changing only the
        capital letters is always allowed; a real change is allowed once per RENAME_COOLDOWN.
        """
        name = name.strip() if isinstance(name, str) else ""
        if not NAME_RE.match(name):
            return None, "bad_name", None
        new = name.lower()
        if new in RESERVED or new.startswith("guest"):
            return None, "reserved", None
        if not isinstance(password, str) or not password:
            return None, "wrong", None
        with self.lock:
            if self._locked(key):
                return None, "locked", None
            row = self.db.execute("SELECT * FROM accounts WHERE key = ?", (key,)).fetchone()
        if not row or row["guest"] or not row["pass_hash"]:
            return None, "guest", None
        if not hmac.compare_digest(_pw_hash(password, row["pass_salt"]), row["pass_hash"]):
            with self.lock:
                self._fail(key)
            return None, "wrong", None
        now = time.time()
        with self.lock:
            self.fails.pop(key, None)
            if new == key:
                self.db.execute("UPDATE accounts SET name = ? WHERE key = ?", (name, key))
                self.db.commit()
                return self.profile(key), None, None
            if now - row["renamed_at"] < RENAME_COOLDOWN:
                return None, "cooldown", row["renamed_at"] + RENAME_COOLDOWN
            if self.db.execute("SELECT 1 FROM accounts WHERE key = ?", (new,)).fetchone():
                return None, "taken", None
            self.db.execute("UPDATE accounts SET key = ?, name = ?, renamed_at = ? WHERE key = ?", (new, name, now, key))
            for table, col in (("sessions", "key"), ("plays", "key"), ("topic_ratings", "key"), ("seen", "key"),
                               ("checkouts", "key"), ("daily_scores", "key"), ("games", "a"), ("games", "b")):
                self.db.execute("UPDATE %s SET %s = ? WHERE %s = ?" % (table, col, col), (new, key))
            self.db.commit()
            return self.profile(new), None, None

    # ---------------------------------------------------------- names from the first version

    def import_legacy(self, players, matches):
        """Copy players and duels from the first version's database. Names already taken are skipped.

        Imported names keep their rating and record but have no password yet: the browser that
        created them still holds the old secret token, which claim_legacy() accepts once.
        """
        added = []
        with self.lock:
            for p in players:
                if self.db.execute("SELECT 1 FROM accounts WHERE key = ?", (p["key"],)).fetchone():
                    continue
                self.db.execute(
                    "INSERT INTO accounts (key, name, avatar, pass_salt, pass_hash, recovery_hash, rating, wins, losses, ties, best, "
                    "solo_best, solo_runs, created, legacy_hash) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (p["key"], p["name"], p["avatar"] if AVATAR_RE.match(p["avatar"] or "") else "c0", b"", b"", p["rating"],
                     p["wins"], p["losses"], p["ties"], p["best"], p["solo_best"], p["solo_runs"], p["created"], p["token_hash"]))
                added.append(p["name"])
            games = 0
            for m in matches:
                if not self.db.execute("SELECT 1 FROM games WHERE ts = ? AND a = ? AND b = ?", (m["ts"], m["a"], m["b"])).fetchone():
                    self.db.execute("INSERT INTO games (ts, mode, a, b, score_a, score_b, delta_a, delta_b, forfeit) "
                                    "VALUES (?, 'duel', ?, ?, ?, ?, ?, ?, ?)",
                                    (m["ts"], m["a"], m["b"], m["score_a"], m["score_b"], m["delta_a"], m["delta_b"], m["forfeit"]))
                    games += 1
            self.db.commit()
        return added, games

    def legacy_info(self, name):
        key = name.strip().lower() if isinstance(name, str) else ""
        with self.lock:
            r = self.db.execute("SELECT name, rating, wins, losses, legacy_hash FROM accounts WHERE key = ?", (key,)).fetchone()
        if not r or not r["legacy_hash"]:
            return {"claimable": False}
        return {"claimable": True, "name": r["name"], "rating": round(r["rating"]), "wins": r["wins"], "losses": r["losses"]}

    def claim_legacy(self, name, token, password):
        """Set a password on a first-version name, proven by its old browser token.
        Returns (profile, session_token, recovery) or (None, error, None)."""
        key = name.strip().lower() if isinstance(name, str) else ""
        if not isinstance(password, str) or not 6 <= len(password) <= 128:
            return None, "weak_password", None
        if not isinstance(token, str) or len(token) > 200:
            return None, "wrong", None
        with self.lock:
            if self._locked("claim:" + key):
                return None, "locked", None
            row = self.db.execute("SELECT legacy_hash FROM accounts WHERE key = ?", (key,)).fetchone()
            if not row or not row["legacy_hash"]:
                return None, "not_legacy", None
            if not hmac.compare_digest(row["legacy_hash"], _sha(token)):
                self._fail("claim:" + key)
                return None, "wrong", None
        salt = os.urandom(16)
        digest = _pw_hash(password, salt)
        recovery = _code(4)
        with self.lock:
            self.db.execute("UPDATE accounts SET pass_salt = ?, pass_hash = ?, recovery_hash = ?, legacy_hash = NULL WHERE key = ?",
                            (salt, digest, _sha(_norm_code(recovery)), key))
            self.db.commit()
            return self.profile(key), self._session(key), recovery

    def reset_password(self, key):
        """Admin: give an account a temporary password (for owners who lost their browser). Returns it."""
        temp = _code(3)
        salt = os.urandom(16)
        digest = _pw_hash(temp, salt)
        with self.lock:
            n = self.db.execute("UPDATE accounts SET pass_salt = ?, pass_hash = ?, legacy_hash = NULL WHERE key = ? AND guest = 0",
                                (salt, digest, key)).rowcount
            self.db.execute("DELETE FROM sessions WHERE key = ?", (key,))
            self.db.commit()
        return temp if n else None

    def backup(self, folder, keep=28):
        """Copy the live database to folder with a timestamp, keeping the newest `keep` copies."""
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, time.strftime("duelette2-%Y%m%d-%H%M%S.db"))
        with self.lock:
            dst = sqlite3.connect(path)
            self.db.backup(dst)
            dst.close()
        old = sorted(f for f in os.listdir(folder) if f.startswith("duelette2-") and f.endswith(".db"))
        for f in old[:-keep]:
            os.remove(os.path.join(folder, f))
        return path

    def _locked(self, key):
        return time.time() < self.fails.get(key, (0, 0))[1]

    def _fail(self, key, limit=5, lock_for=300):
        count, until = self.fails.get(key, (0, 0))
        count += 1
        self.fails[key] = (0, time.time() + lock_for) if count >= limit else (count, until)

    def login(self, name, password):
        """Returns (profile, token) or (None, error)."""
        key = name.strip().lower() if isinstance(name, str) else ""
        if not isinstance(password, str) or not key:
            return None, "wrong"
        with self.lock:
            if self._locked(key):
                return None, "locked"
            row = self.db.execute("SELECT * FROM accounts WHERE key = ?", (key,)).fetchone()
        if row and row["legacy_hash"]:
            return None, "legacy"
        if not row:
            _pw_hash(password, b"0" * 16)  # same cost either way, so timing does not reveal names
            return None, "wrong"
        ok = hmac.compare_digest(_pw_hash(password, row["pass_salt"]), row["pass_hash"])
        with self.lock:
            if not ok:
                self._fail(key)
                return None, "wrong"
            self.fails.pop(key, None)
            return self.profile(key), self._session(key)

    def recover(self, name, code, password):
        """Reset the password with the recovery code. Returns (profile, token, new_code) or (None, error, None)."""
        key = name.strip().lower() if isinstance(name, str) else ""
        if not isinstance(password, str) or not 6 <= len(password) <= 128:
            return None, "weak_password", None
        with self.lock:
            if self._locked(key):
                return None, "locked", None
            row = self.db.execute("SELECT * FROM accounts WHERE key = ?", (key,)).fetchone()
            if not row or not hmac.compare_digest(row["recovery_hash"], _sha(_norm_code(code))):
                if row:
                    self._fail(key)
                return None, "wrong", None
        salt = os.urandom(16)
        digest = _pw_hash(password, salt)
        new_code = _code(4)
        with self.lock:
            self.db.execute("UPDATE accounts SET pass_salt = ?, pass_hash = ?, recovery_hash = ? WHERE key = ?",
                            (salt, digest, _sha(_norm_code(new_code)), key))
            self.db.execute("DELETE FROM sessions WHERE key = ?", (key,))
            self.db.commit()
            self.fails.pop(key, None)
            return self.profile(key), self._session(key), new_code

    def account_for(self, token):
        """The account key a session token belongs to, or None."""
        if not isinstance(token, str) or len(token) > 100:
            return None
        now = time.time()
        with self.lock:
            row = self.db.execute("SELECT key, seen FROM sessions WHERE token_hash = ?", (_sha(token),)).fetchone()
            if not row or now - row["seen"] > SESSION_TTL:
                return None
            if now - row["seen"] > 3600:
                self.db.execute("UPDATE sessions SET seen = ? WHERE token_hash = ?", (now, _sha(token)))
                self.db.commit()
            return row["key"]

    def logout(self, token):
        with self.lock:
            self.db.execute("DELETE FROM sessions WHERE token_hash = ?", (_sha(token),))
            self.db.commit()

    def set_avatar(self, key, avatar):
        if not AVATAR_RE.match(avatar or ""):
            return False
        with self.lock:
            self.db.execute("UPDATE accounts SET avatar = ? WHERE key = ?", (avatar, key))
            self.db.commit()
        return True

    # ---------------------------------------------------------- plans

    def is_pro(self, key):
        return self.quota(key)["pro"]

    def quota(self, key):
        day, reset_at = today()
        with self.lock:
            row = self.db.execute("SELECT pro_until, sub_id, sub_status, sub_until FROM accounts WHERE key = ?", (key,)).fetchone()
            used = self.db.execute("SELECT count FROM plays WHERE key = ? AND day = ?", (key, day)).fetchone()
        until = max(row["pro_until"], row["sub_until"]) if row else 0
        pro = until > time.time()
        used = used["count"] if used else 0
        sub = {"status": row["sub_status"], "until": row["sub_until"]} if row and row["sub_id"] else None
        return {"pro": pro, "proUntil": until if pro else None, "used": used, "subscription": sub,
                "limit": None if pro else FREE_GAMES, "left": None if pro else max(0, FREE_GAMES - used), "resetAt": reset_at}

    # Lemon Squeezy subscriptions (see billing.py)

    def new_checkout_ref(self, key):
        ref = secrets.token_urlsafe(16)
        with self.lock:
            self.db.execute("INSERT INTO checkouts (ref, key, created) VALUES (?, ?, ?)", (ref, key, time.time()))
            self.db.commit()
        return ref

    def key_for_ref(self, ref):
        with self.lock:
            row = self.db.execute("SELECT key FROM checkouts WHERE ref = ?", (str(ref),)).fetchone()
        return row["key"] if row else None

    def key_for_subscription(self, sub_id):
        with self.lock:
            row = self.db.execute("SELECT key FROM accounts WHERE sub_id = ?", (str(sub_id),)).fetchone()
        return row["key"] if row else None

    def subscription_id(self, key):
        with self.lock:
            row = self.db.execute("SELECT sub_id FROM accounts WHERE key = ?", (key,)).fetchone()
        return row["sub_id"] if row else None

    def set_subscription(self, key, sub_id, status, access_until):
        with self.lock:
            self.db.execute("UPDATE accounts SET sub_id = ?, sub_status = ?, sub_until = ? WHERE key = ?",
                            (str(sub_id), status, access_until, key))
            self.db.commit()

    def can_play(self, key):
        q = self.quota(key)
        return q["pro"] or q["left"] > 0

    def use_play(self, key):
        """Count one game for today."""
        day, _ = today()
        with self.lock:
            self.db.execute("INSERT INTO plays (key, day, count) VALUES (?, ?, 1) "
                            "ON CONFLICT(key, day) DO UPDATE SET count = count + 1", (key, day))
            self.db.commit()

    def create_codes(self, count, days):
        codes = []
        with self.lock:
            for _ in range(count):
                code = "PRO-" + _code(3)
                self.db.execute("INSERT INTO pro_codes (code_hash, days, created) VALUES (?, ?, ?)", (_sha(_norm_code(code)), days, time.time()))
                codes.append(code)
            self.db.commit()
        return codes

    def grant(self, key, days):
        with self.lock:
            row = self.db.execute("SELECT pro_until FROM accounts WHERE key = ?", (key,)).fetchone()
            if not row:
                return None
            until = max(time.time(), row["pro_until"]) + days * 86400
            self.db.execute("UPDATE accounts SET pro_until = ? WHERE key = ?", (until, key))
            self.db.commit()
            return until

    def redeem(self, key, code):
        """Redeem a one-time Pro code. Returns (pro_until, None) or (None, error)."""
        lock_key = "redeem:" + key
        with self.lock:
            if self._locked(lock_key):
                return None, "locked"
            row = self.db.execute("SELECT * FROM pro_codes WHERE code_hash = ?", (_sha(_norm_code(code)),)).fetchone()
            if not row:
                self._fail(lock_key, limit=8, lock_for=900)
                return None, "bad_code"
            if row["used_by"]:
                return None, "used"
            self.db.execute("UPDATE pro_codes SET used_by = ?, used_at = ? WHERE code_hash = ?", (key, time.time(), row["code_hash"]))
            self.db.commit()
            return self.grant(key, row["days"]), None

    # ---------------------------------------------------------- learning: item and topic ratings

    def item_ratings(self):
        with self.lock:
            return {r["id"]: r["rating"] for r in self.db.execute("SELECT id, rating FROM item_stats")}

    def topic_ratings(self, key):
        with self.lock:
            return {r["topic"]: r["rating"] for r in self.db.execute("SELECT topic, rating FROM topic_ratings WHERE key = ?", (key,))}

    def recently_seen(self, keys, days=21):
        since = time.time() - days * 86400
        with self.lock:
            out = set()
            for k in keys:
                out.update(r["item"] for r in self.db.execute("SELECT item FROM seen WHERE key = ? AND ts > ?", (k, since)))
            return out

    def _topic_avg(self, topic, ratings):
        ids = [i for i, t in self.item_topics.items() if t == topic]
        return sum(ratings.get(i, START_RATING) for i in ids) / len(ids) if ids else START_RATING

    def record_answer(self, key, item_id, topic, score):
        """Update the player's topic rating and the question's rating. score is 0..1."""
        score = max(0.0, min(1.0, float(score)))
        with self.lock:
            row = self.db.execute("SELECT * FROM topic_ratings WHERE key = ? AND topic = ?", (key, topic)).fetchone()
            item = self.db.execute("SELECT * FROM item_stats WHERE id = ?", (item_id,)).fetchone()
            pr = row["rating"] if row else START_RATING
            answers = (row["answers"] if row else 0) + 1
            ir = item["rating"] if item else START_RATING
            e = _expected(pr, ir)
            pk = 40 if answers <= 10 else 24
            pr2 = pr + pk * (score - e)
            ir2 = ir - ITEM_K * (score - e)
            self.db.execute("INSERT INTO item_stats (id, rating, attempts, score) VALUES (?, ?, 1, ?) "
                            "ON CONFLICT(id) DO UPDATE SET rating = ?, attempts = attempts + 1, score = score + ?",
                            (item_id, ir2, score, ir2, score))
            baseline = row["baseline"] if row else None
            if baseline is None and answers >= 5:
                baseline = round(100 * _expected(pr2, self._topic_avg(topic, self.item_ratings())))
            self.db.execute("INSERT INTO topic_ratings (key, topic, rating, answers, baseline) VALUES (?, ?, ?, ?, ?) "
                            "ON CONFLICT(key, topic) DO UPDATE SET rating = ?, answers = ?, baseline = ?",
                            (key, topic, pr2, answers, baseline, pr2, answers, baseline))
            self.db.execute("INSERT INTO seen (key, item, ts) VALUES (?, ?, ?) ON CONFLICT(key, item) DO UPDATE SET ts = ?",
                            (key, item_id, time.time(), time.time()))
            self.db.commit()

    def mastery(self, key):
        """Per topic: the chance of answering a typical question right, now and after the first 5 answers."""
        ratings = self.item_ratings()
        with self.lock:
            rows = {r["topic"]: r for r in self.db.execute("SELECT * FROM topic_ratings WHERE key = ?", (key,))}
        out = []
        for topic, label in self.topic_names.items():
            r = rows.get(topic)
            if not r:
                out.append({"topic": topic, "label": label, "pct": None, "baseline": None, "answers": 0})
                continue
            out.append({"topic": topic, "label": label, "answers": r["answers"], "baseline": r["baseline"],
                        "pct": round(100 * _expected(r["rating"], self._topic_avg(topic, ratings)))})
        return out

    # ---------------------------------------------------------- profiles and rankings

    def _duel_rank(self, rating):
        return self.db.execute("SELECT COUNT(*) + 1 AS r FROM accounts WHERE rating > ? AND wins + losses + ties > 0 AND guest = 0",
                               (rating,)).fetchone()["r"]

    def _solo_rank(self, score):
        return self.db.execute("SELECT COUNT(*) + 1 AS r FROM accounts WHERE solo_best > ? AND solo_runs > 0 AND guest = 0",
                               (score,)).fetchone()["r"]

    def profile(self, key):
        with self.lock:
            r = self.db.execute("SELECT * FROM accounts WHERE key = ?", (key,)).fetchone()
            if not r:
                return None
            played = r["wins"] + r["losses"] + r["ties"]
            ranked = not r["guest"]
            plan = self.quota(key)
            return {"streak": self._streak_view(r, plan["pro"]), "daily": self.daily_status(key),"name": r["name"], "avatar": r["avatar"], "guest": bool(r["guest"]), "rating": round(r["rating"]), "played": played,
                    "renameAt": max(0.0, r["renamed_at"] + RENAME_COOLDOWN) if r["renamed_at"] else 0,
                    "wins": r["wins"], "losses": r["losses"], "ties": r["ties"], "best": r["best"],
                    "rank": self._duel_rank(r["rating"]) if played and ranked else None,
                    "soloBest": r["solo_best"], "soloRuns": r["solo_runs"],
                    "soloRank": self._solo_rank(r["solo_best"]) if r["solo_runs"] and ranked else None,
                    "plan": plan, "mastery": self.mastery(key)}

    def apply_duel(self, key_a, key_b, scores, forfeit_seat):
        """Record a finished duel and update Elo. Returns the rating change for both seats."""
        if forfeit_seat is None:
            outcome_a = 1.0 if scores[0] > scores[1] else 0.0 if scores[0] < scores[1] else 0.5
        else:
            outcome_a = 0.0 if forfeit_seat == 0 else 1.0
        with self.lock:
            rows = [self.db.execute("SELECT * FROM accounts WHERE key = ?", (k,)).fetchone() for k in (key_a, key_b)]
            if not all(rows):
                return [None, None]
            if rows[0]["guest"] or rows[1]["guest"]:  # guests play unranked, so ratings stay honest
                self.db.execute("INSERT INTO games (ts, mode, a, b, score_a, score_b, delta_a, delta_b, forfeit) "
                                "VALUES (?, 'duel', ?, ?, ?, ?, 0, 0, ?)", (time.time(), key_a, key_b, scores[0], scores[1], forfeit_seat))
                self.db.commit()
                return [None, None]
            ra, rb = rows[0]["rating"], rows[1]["rating"]
            delta_a = K * (outcome_a - _expected(ra, rb))
            deltas, outcome = [delta_a, -delta_a], [outcome_a, 1.0 - outcome_a]
            for i, row in enumerate(rows):
                self.db.execute(
                    "UPDATE accounts SET rating = rating + ?, wins = wins + ?, losses = losses + ?, ties = ties + ?, "
                    "best = MAX(best, ?) WHERE key = ?",
                    (deltas[i], int(outcome[i] == 1.0), int(outcome[i] == 0.0), int(outcome[i] == 0.5), scores[i], row["key"]))
            self.db.execute("INSERT INTO games (ts, mode, a, b, score_a, score_b, delta_a, delta_b, forfeit) "
                            "VALUES (?, 'duel', ?, ?, ?, ?, ?, ?, ?)",
                            (time.time(), key_a, key_b, scores[0], scores[1], deltas[0], deltas[1], forfeit_seat))
            self.db.commit()
            out = []
            for i, row in enumerate(rows):
                after = row["rating"] + deltas[i]
                out.append({"before": round(row["rating"]), "after": round(after),
                            "delta": round(after) - round(row["rating"]), "rank": self._duel_rank(after)})
            return out

    def apply_solo(self, key, score):
        with self.lock:
            row = self.db.execute("SELECT solo_best FROM accounts WHERE key = ?", (key,)).fetchone()
            if not row:
                return None
            self.db.execute("UPDATE accounts SET solo_best = MAX(solo_best, ?), solo_runs = solo_runs + 1 WHERE key = ?", (score, key))
            self.db.execute("INSERT INTO games (ts, mode, a, score_a) VALUES (?, 'solo', ?, ?)", (time.time(), key, score))
            self.db.commit()
            best = max(row["solo_best"], score)
            guest = self.db.execute("SELECT guest FROM accounts WHERE key = ?", (key,)).fetchone()["guest"]
            return {"best": best, "newBest": score > row["solo_best"], "rank": None if guest else self._solo_rank(best)}

    def leaderboard(self, board, limit):
        now = time.time()
        with self.lock:
            if board == "today":
                rows = self.db.execute("SELECT a.*, d.score AS daily_score FROM daily_scores d JOIN accounts a ON a.key = d.key "
                                       "WHERE d.day = ? AND a.guest = 0 ORDER BY d.score DESC, d.ts ASC LIMIT ?", (today()[0], limit)).fetchall()
                return [{"rank": i + 1, "name": r["name"], "avatar": r["avatar"], "score": r["daily_score"], "streak": r["streak"],
                         "pro": max(r["pro_until"], r["sub_until"]) > now} for i, r in enumerate(rows)]
            if board == "solo":
                rows = self.db.execute("SELECT * FROM accounts WHERE solo_runs > 0 AND guest = 0 ORDER BY solo_best DESC, created ASC LIMIT ?",
                                       (limit,)).fetchall()
            else:
                rows = self.db.execute("SELECT * FROM accounts WHERE wins + losses + ties > 0 AND guest = 0 "
                                       "ORDER BY rating DESC, wins DESC, created ASC LIMIT ?", (limit,)).fetchall()
        return [{"rank": i + 1, "name": r["name"], "avatar": r["avatar"], "rating": round(r["rating"]),
                 "wins": r["wins"], "losses": r["losses"], "ties": r["ties"], "best": r["best"],
                 "soloBest": r["solo_best"], "soloRuns": r["solo_runs"], "pro": max(r["pro_until"], r["sub_until"]) > now} for i, r in enumerate(rows)]
