# Scaling Trap Chat

Written for whoever picks this up when it starts growing. It is not a wish
list: everything here is a real limit in the code as it stands, in the order
it will actually bite, with the specific thing that has to change.

Read [AGENTS.md](AGENTS.md) first for how the app works and why. This document
only covers what breaks under load.

## What the app is today

One Azure Container App replica. One Gunicorn worker, `gthread`, 100 threads.
SQLite on an Azure Files SMB share. Everything that coordinates players lives
in that one process's memory.

```
Browser ──HTTPS/WebSocket──> Container App (1 replica, 1 worker)
                                  │
                                  ├── SQLite on Azure Files (/data)
                                  └── in-process: matchmaking lock,
                                      socket identities, room presence
Browser <────── WebRTC peer to peer (STUN only, no TURN) ──────> Browser
```

This is a deliberate shape for the current size, not an accident. It costs
almost nothing and it is easy to reason about. It also cannot be scaled by
adding a replica, and the reasons are specific.

## The order things break

Rough figures. Measure before acting on any of them.

| # | Limit | Bites at roughly | Symptom |
|---|---|---|---|
| 1 | WebRTC has no TURN | Any size | 10–20% of pairs never see each other |
| 2 | Cold start from `min_replicas = 0` | Any traffic after idle | First visitor waits ~20s |
| 3 | SQLite single writer on SMB | ~20–50 concurrent writers | `database is locked`, 500s |
| 4 | Single replica ceiling | ~200–500 concurrent sockets | CPU saturates, latency climbs |
| 5 | In-process coordination | The moment you add a replica | Players never match, rooms look empty |
| 6 | Leaderboard full scan | ~100k rows | Slow board reads |
| 7 | Video mesh is O(n²) per room | ~7 people in one room | Uploads saturate, tiles freeze |

## 1. TURN, before anything else

**This is the highest-value fix and it is not really a scaling problem — it is
broken today.** `webrtc.ts` lists two Google STUN servers and no TURN. STUN
cannot traverse symmetric NAT, which is common on mobile carriers and
corporate networks, so a meaningful share of pairs connect the signalling,
join the room, and then never see each other's video.

Add a TURN server and put it in `ICE_SERVERS`. Managed options exist
(Twilio, Cloudflare Calls, Metered); self-hosting `coturn` on a small VM is
cheaper past a certain volume. Credentials must be short-lived and fetched
from the backend, never baked into the bundle.

Cost note: TURN relays media, so it is billed on bandwidth. Only the pairs
that cannot go direct will use it.

## 2. Cold start

`min_replicas = 0` in [infra/terraform/main.tf](infra/terraform/main.tf).
The container scales to zero when idle, so the first request after a quiet
spell waits for a container to start — measured at about 20 seconds.

Setting `min_replicas = 1` removes it entirely. It was left at zero
deliberately to stay inside the free grant, which one always-on replica
exceeds. This is a cost decision, not a technical one: make it the moment
somebody other than you is visiting.

## 3. SQLite has to go before the second replica

SQLite on an SMB share is one writer at a time over a network filesystem. The
app already carries scar tissue from this: `nobrl` in the mount options, a 30
second busy timeout, `check_same_thread: False`, and a retry loop around
`create_all`.

**Move to Postgres** (Azure Database for PostgreSQL flexible server, burstable
tier). The code is SQLAlchemy throughout, so the change is mostly:

- `DATABASE_URL` to a Postgres URL, and drop the SQLite-specific
  `SQLALCHEMY_ENGINE_OPTIONS` block in `app.py`
- Delete the Azure Files share and its mount from the Container App
- Add a real migration tool. There is none today: `_ensure_schema()` does
  hand-rolled `ALTER TABLE` checks, which was fine for one column and will not
  survive a team. Alembic, before anyone else joins.
- Move the data. There is not much of it; a script that reads the SQLite file
  and writes rows through the same models is enough.

Do this **before** step 4, not after. Postgres is what makes the next step
possible.

## 4 and 5. The second replica, and what it breaks

`max_replicas = 1` is load-bearing. Four pieces of state live in one
process's memory, and a second replica silently breaks all four:

| State | Where | What breaks with two replicas |
|---|---|---|
| `MATCHMAKING_LOCK` | `app.py:39` | Two callers on different replicas both find the queue empty and both open a match nobody else can see |
| `SOCKET_IDENTITIES` | `app.py:1497` | A socket on replica B is unknown to replica A, so `join_match` is refused |
| `MATCH_LAST_SEEN` | `app.py:368` | Room presence is per replica, so the reaper deletes rooms that are full |
| `_LOGIN_ATTEMPTS` | `app.py:78` | Rate limiting resets by landing on the other replica |

Socket.IO rooms are also per process. A `match_start` emitted on replica A
never reaches a player connected to replica B.

The migration, in order:

1. **Add Redis** (Azure Cache for Redis, basic tier).
2. **Message queue for Socket.IO.** `socketio.init_app(app,
   message_queue='redis://...')`. This is the single most important line: it
   is what makes rooms and broadcasts work across replicas. Flask-SocketIO
   supports it directly.
3. **Matchmaking lock to Redis.** A `SETNX` lock with a timeout, or do the
   pairing in a Postgres transaction with `SELECT ... FOR UPDATE SKIP LOCKED`
   and drop the application lock entirely. The second is better: it is one
   fewer system, and the database is already the source of truth.
4. **Socket identities to Redis**, keyed by socket id with a TTL.
5. **Presence to Redis**, replacing `MATCH_LAST_SEEN` — a key per match with a
   TTL is a closer fit than the current dictionary anyway.
6. **Rate limiting to Redis.**
7. Only then raise `max_replicas`, and set the Container App scale rule on
   concurrent requests.

**Do not raise `max_replicas` before finishing this list.** The failure is
silent: matchmaking appears to work and simply never pairs anyone. Three
separate bug reports in this project's history were exactly that shape from
in-process causes, and they are hard to see from the outside.

## 7. The video mesh, and why it stops at six

Group video is a full mesh: every participant holds one `RTCPeerConnection`
per other participant and uploads their camera separately to each. Four people
is three uploads each; ten would be nine, which no ordinary home connection
sustains. Cost grows with the square of the room while the *server* cost stays
zero, which is exactly the trade that makes this app cheap to run — and
exactly why it cannot be stretched.

`MAX_VIDEO_PEERS = 6` in `webrtc.ts` is where it stops. Past it everybody
still gets a tile with their name on it and no video is negotiated for them,
because a room that silently dropped people would be worse than one that
admits its limit. Group Chat's `max_players` is 20, so this is reachable.

The answer beyond that is an SFU: each participant uploads once, the server
fans out. That means media through a server for the first time, which is a
real bill and the end of "the backend only relays the handshake". Not worth it
for a pilot; the thing to measure first is whether rooms of seven happen at
all.

## 6. Leaderboards

`api_leaderboard` scans `Leaderboard` for a game, orders by score, limits 100.
Fine at any size worth having. When it is not: index `(game_id, best_score
DESC)` and cache the top 100 per game in Redis with a short TTL. Leave it
alone until then.

## Things that do not need scaling

Say so explicitly, so nobody spends time here:

- **Pose detection and punch counting.** Entirely on the client. A thousand
  more players costs the server nothing.
- **The frontend.** Static files on a CDN.
- **WebRTC media.** Peer to peer. The server relays the handshake only, which
  is a few kilobytes per call. This is the reason video is affordable at all,
  and it should stay that way — a media server (SFU) is only worth it for
  group video, which the product does not have.

## What to measure before any of this

Guessing is how you end up optimising the wrong thing:

- Container App CPU, memory and replica count in Azure Monitor
- `database is locked` occurrences in the container logs — the SQLite signal
- WebRTC connection failures: `callState === 'failed'` is already tracked
  client-side and is not reported anywhere. Send it somewhere; it is how you
  size the TURN decision.
- Socket count per replica
- p95 latency on `/api/matches/quick`

Nothing reports to a metrics backend today. Application Insights on the
Container App is the cheapest way to start and should probably come first, so
that every decision after it is made on numbers.

## Rough cost shape

Today: near zero — scale-to-zero compute, a file share, static hosting.

After the full migration: a burstable Postgres, a basic Redis, one or more
always-on replicas, and TURN bandwidth. Expect tens of dollars a month at
small scale, dominated by whichever of Postgres and Redis you size first.
Neither needs to be large.
