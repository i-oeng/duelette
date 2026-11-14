# Duelette

**Spin the wheel, duel a stranger, learn something every round.**

Live: **https://forteveriti.tail8331b7.ts.net/duelette/** (no sign-up needed, press play)

Business Cup 2.0 · Track 02, Entertainment · B2C · web only

## The problem

US adults aged 25 to 45 spend their short breaks (the commute, lunch, the ten minutes after the kids fall asleep) scrolling, and come away feeling the time was wasted. Duelette turns five minutes of downtime into a competitive game that leaves you a little smarter: real opponents, real stakes, and a lesson in every answer.

## What you play

Each round you spin a wheel:

| Wedge | What happens | What you learn |
|---|---|---|
| **Trivia Blitz** | 5 quick questions, many on US personal finance (credit scores, 401(k), inflation); faster right answers score more | A one-line "why" after every answer |
| **Money Math** | 4 everyday dollar problems: tips, discounts, splitting a bill, card interest, hourly pay to yearly pay. Generated on the server, so they never run out | The worked answer, step by step |
| **Myth or Fact** | 5 things people believe ("checking your own credit score lowers it"); call each one | Why it is a myth, or why it is true |
| **Which Came First?** | 5 pairs of events ("YouTube or the first iPhone?"); pick the earlier one | Both dates |
| **Spot the Scam** | 5 real-looking texts, emails, calls and pop-ups: call each one Scam or Legit | The tell (lookalike domain, gift card request, a code you never asked for) or why it is safe |
| **Ballpark** | Estimate 4 numbers ("how far away is the Moon?") | The real number, how far off you were, and why |
| **Code Sprint** | Write one JavaScript function against live tests; up to 2 hints, each costing 20% of the round | Your code side by side with a model solution (and your opponent's) |
| **Jackpot** | Doubles the next challenge and spins again | |
| **Chaos** | A random challenge with a twist (Sudden Death, Speed round, Overtime, No Loops...) | |

Every round pays at most 300 points whatever its length, so no wedge is worth more than another.

Five spins make a game, about five minutes.

## Modes

- **Daily Duel**: the same five spins for everyone today, free once a day, with a daily leaderboard and a shareable result.
- **Solo run**: chase your best score and the world solo board.
- **Find a match**: random matchmaking with an Elo world rating. If nobody is around after 12 seconds, a clearly labelled practice bot steps in (unranked).
- **Challenge a friend**: send a link; the duel starts the moment they open it. Friendly matches don't change ratings.

## Why people come back

- **Daily streaks** for finishing at least one game a day, shown on the profile and the result screen.
- **Levels and XP**: every finished game earns XP (more for a high score, a duel win, the Daily Duel and quests), with a level bar on the profile and the result screen.
- **Daily quests**: three small goals a day, the same for everyone ("Solve 3 Money Math problems", "Win 3 duel rounds"). +50 XP each, +100 for all three.
- **Badge collection**: 17 badges earned from what really happened in a game (judged on the server), kept on the account.
- **Critter unlocks**: four critters are free; the rest unlock at levels 3, 5 and 8 and with a 7-day streak.
- **Rematch**: after a duel either player can offer a rematch for 45 seconds; it starts the moment both agree (friendly, so ratings can't be farmed).
- **Daily percentile**: "You beat 72% of today's players", on the result screen and in the share text.
- **Mastery meters** per topic (Finance, History, Science, Geography, Tech, Culture, Scam spotting): the chance you'd answer a typical question right, and how far it moved since you started.
- **Questions that fit you**: every question carries a difficulty rating that moves like a chess rating, and each player gets questions they answer right about 65% of the time.
- Badges, jackpots, win streaks and a world ranking.

The private bank holds 173 trivia questions, 34 myth or fact statements, 27 event pairs, 26 scam messages, 29 estimates and 50 code challenges (255 tests), each with an explanation or hints, plus Money Math problems generated on the fly.

Two complete themes: **Classic** (sunburst yellow, sticker outlines, Bungee and Fredoka) and **Zimrany**, inspired by zimran.io, one of the Business Cup 2.0 organizers (violet, black and white, Unbounded and Manrope, soft shadows, pill buttons, its own wheel and logo colors). The header button switches them instantly; the choice is saved on the device.

## Business model

- **Free**: the Daily Duel plus 3 games a day. Guests can play instantly and save their progress later.
- **Paid** (Lemon Squeezy, merchant of record): **Mensis** $4.99 a month or **Annum** $39.99 a year. Unlimited games, Streak Freeze (one missed day a week is forgiven), and a Member badge.
- Growth: friend challenge links and shareable Daily Duel results bring new players for free.

## Fair play: scores can't be faked

The server runs every game; the browser only sends actions.

- Answers never reach the browser; timing is measured on the server clock.
- Submitted code is re-run on the server inside a bubblewrap sandbox (no network, no file access) against visible **and hidden** tests, so hardcoding the visible answers fails.
- The production question bank (`content.json`) stays private so nobody can read the answers. This repo ships `content.sample.json`, which the server uses automatically.
- Accounts use salted PBKDF2 passwords, session tokens stored only as hashes, and one-time recovery codes. Guest duels and bot or friend matches never move ratings.

## Architecture

```
browser (index.html, style.css, js/*.js: vanilla, no build step)
   |  HTTPS + server-sent events
server.py   HTTP API and event stream (Python standard library only)
engine.py   game engine: matchmaking, rooms, practice bot, Daily Duel, scoring
mathgen.py  Money Math problems with computed answers and plausible wrong ones
accounts.py SQLite: accounts, sessions, ratings, streaks, plans, question difficulty, mastery
judge.py    estimation scoring and sandboxed code checks (sandbox/runner.js inside bubblewrap)
billing.py  Lemon Squeezy checkout and signed webhooks
admin.py    backups, gift codes, password resets, stats
```

Production runs on an Ubuntu machine as a systemd user service behind Tailscale Funnel, with automatic database backups every 6 hours.

## Run it locally

```bash
python3 server.py              # http://127.0.0.1:8787, uses content.sample.json
```

Python 3.9 or newer, no packages needed. Code checks need `bwrap` and `node`; on a development machine without bubblewrap, set `DUELETTE_UNSAFE_LOCAL=1` to run them unsandboxed (development only).

Optional settings: `PORT`, `DATA_DIR`, `DUELETTE_TZ` (default `America/New_York`), `DUELETTE_FREE_GAMES` (default 3), and for billing `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_VARIANT_ID`, `LEMONSQUEEZY_ANNUAL_VARIANT_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`.

## Admin

```bash
python3 admin.py stats                 # accounts, members, games today
python3 admin.py backup                # copy the database to ./backups
python3 admin.py codes 10 --days 30    # one-time gift codes
python3 admin.py reset-password NAME   # temporary password for a locked-out player
```
