# Trap Chat — Specification

## Core Concept
Chat Roulette + competitive minigames. Tiled lobby: **Chat** mode (make friends) or **Competitive** mode (games). Username login for high scores/leaderboards/local-area matchmaking. Guest mode for quick play.

## Games (7 total)

### 1v1 Games (max 2 players)
| Game | Win Condition | Data Captured |
|------|---------------|---------------|
| Push-ups | Most reps in time | rep_count, duration_sec |
| Squats | Most reps in time | rep_count, duration_sec |
| Rap Battle | Peer vote after timer | bars_text, votes_received |
| Facial Symmetry | ML symmetry score | symmetry_score (0-100) |
| Mog (Looksmaxx) | Peer vote after timer | votes_received |

### Free-For-All Games (up to 20 players)
| Game | Win Condition | Data Captured |
|------|---------------|---------------|
| Text Chat FFA | N/A (social) | messages_sent |
| Generic FFA Lobby | N/A (social) | time_in_room |

## User System
- **Account**: username, email (optional), password_hash, created_at, preferences_json, location_approx (lat/lng for local priority)
- **Guest**: session_id, display_name ("Guest_XXXX"), no persistence beyond session
- **Preferences**: game_filters, max_players, local_radius_km, notifications, theme

## Matchmaking
- Local-area priority (geo-distance sort) → then by skill/rating → then random
- Room settings (host-configurable): game, max_players, time_limit, local_only, rated/unrated
- 1v1 = quick match; FFA = lobby fill to max_players or start after 30s

## Persistence
- SQLite (dev) / Postgres (prod) for: users, games, matches, scores, leaderboards, rooms, room_settings, preferences
- Agora/WebRTC signaling reused for real-time; game state via WebSocket or polling

## Schema (SQLite)
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    preferences_json TEXT DEFAULT '{}',
    lat REAL,
    lng REAL,
    rating INTEGER DEFAULT 1000
);

CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,         -- pushups, squats, rapbattle, symmetry, mog, textchat, ffa
    name TEXT NOT NULL,
    max_players INTEGER NOT NULL,
    is_1v1 BOOLEAN NOT NULL,
    default_time_sec INTEGER
);

CREATE TABLE matches (
    id INTEGER PRIMARY KEY,
    game_id INTEGER REFERENCES games(id),
    room_code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,              -- waiting, active, finished
    host_user_id INTEGER REFERENCES users(id),
    settings_json TEXT DEFAULT '{}',
    started_at DATETIME,
    finished_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE match_players (
    id INTEGER PRIMARY KEY,
    match_id INTEGER REFERENCES matches(id),
    user_id INTEGER REFERENCES users(id),   -- NULL for guests
    guest_session_id TEXT,                -- for guests
    display_name TEXT NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    left_at DATETIME,
    result_json TEXT                      -- game-specific: reps, votes, score, etc.
);

CREATE TABLE leaderboards (
    id INTEGER PRIMARY KEY,
    game_id INTEGER REFERENCES games(id),
    user_id INTEGER REFERENCES users(id),
    best_score REAL NOT NULL,
    achieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, user_id)
);

CREATE TABLE rooms (
    id INTEGER PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    game_id INTEGER REFERENCES games(id),
    host_user_id INTEGER REFERENCES users(id),
    settings_json TEXT DEFAULT '{}',
    status TEXT NOT NULL,                -- open, locked, in_progress, closed
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Frontend Pages (Tiled Layout)
1. **Landing** → "Enter as Guest" | "Login / Register"
2. **Tiled Lobby** (after auth):
   - Left tile: **Chat** (text/video rooms, Chat Roulette style)
   - Right tile: **Competitive** (game picker grid)
3. **Game Picker** (modal or sub-page): cards for each game with 1v1/FFA badge
4. **Room / Match Screen**: game-specific HUD (timer, counter, vote buttons, video feeds)
5. **Results / Leaderboard** overlay
6. **Account Settings**: preferences, location, password, stats

## Tech Stack
- Backend: Flask + Flask-SocketIO (real-time) + SQLAlchemy
- Frontend: Vanilla JS modules (ESM) + existing Agora RTM/WebRTC for video
- Auth: bcrypt + JWT (HttpOnly cookie) + guest session cookie
- Deploy: Vercel (serverless functions) or Docker → Azure (legacy)

## API Endpoints (REST + SocketIO)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | public | Create account |
| POST | /api/auth/login | public | Login → JWT cookie |
| POST | /api/auth/guest | public | Guest session cookie |
| GET | /api/auth/me | cookie | Current user/profile |
| PUT | /api/auth/preferences | cookie | Update preferences |
| GET | /api/games | public | List games + metadata |
| POST | /api/matches/quick | cookie/guest | 1v1 quick match |
| POST | /api/rooms | cookie | Create room (host) |
| GET | /api/rooms | public | List open rooms |
| POST | /api/rooms/:code/join | cookie/guest | Join room |
| WS | /ws/match/:match_id | cookie/guest | Real-time game state |
| POST | /api/matches/:id/submit | cookie/guest | Submit game result |
| GET | /api/leaderboard/:game_slug | public | Top 100 |

## Game-Specific Logic
- **Push-ups / Squats**: Phone accelerometer or webcam pose (MediaPipe) → count reps. Server trusts client count (anti-cheat later).
- **Rap Battle**: 60s timer → each submits text → both vote (or spectators) → winner = most votes.
- **Facial Symmetry**: MediaPipe FaceMesh → compute symmetry → server receives score.
- **Mog**: 30s timer → peers vote "mog" / "not" → highest ratio wins.
- **Text Chat FFA**: Agora RTM text channel, up to 20.
- **Generic FFA**: Video grid (Agora RTC) up to 20, no scoring.

## Local-Area Priority
- On matchmaking, `ORDER BY ST_Distance(POINT(lng, lat), POINT(:my_lng, :my_lat))` (PostGIS) or haversine in SQLite.
- Room setting `local_only=true` filters to radius.

## Repo Rename
`ItMeansBigMountain/RTS-JS-ChatRooms` → `ItMeansBigMountain/trap-chat`