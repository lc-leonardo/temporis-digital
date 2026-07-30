---
marp: true
title: Temporis Digital — Database Systems
theme: default
paginate: true
---

# Temporis Digital
## Card game + MongoDB in practice

**Course:** Database Systems  
**Project:** digital card game with LAN backend + MongoDB persistence  
**Presenter:** _your name here_

---

# Agenda (30 min)

1. Project context and goals (3 min)
2. Game and technical architecture (5 min)
3. MongoDB data modeling (8 min)
4. Data flow and queries (4 min)
5. Quality, testing, and lessons learned (3 min)
6. **Live demo/tutorial with the class** (7 min)

> Fewer slides, more practice: the idea is to show the architecture **and** let people play.

---

# Problem and proposal

- I wanted a database project that went beyond simple CRUD.
- I chose a card game to generate real session, match, and leaderboard data.
- Data-layer goals:
  - persist match results
  - maintain per-player statistics
  - support leaderboard queries
  - store LAN room chat history

---

# The game (quick summary)

- **Temporis Digital**: a turn-based game with event/action/paradox cards.
- Play modes:
  - local (player + bots)
  - LAN (WebSocket)
  - guided tutorial
- The rules engine is deterministic and separated from the UI.

**Why does this matter for databases?**  
The game generates analytics-ready data: winners, play frequency, performance, game mode, etc.

---

# Inspirations

- Inspirations from pop culture for the game development:
    - Steins;Gate
    - Higurashi
    - Re:Zero
    - Tokyo Revengers
    - Back to the future

---

# Architecture (high-level view)

- **Frontend:** React + TypeScript (Vite)
- **Backend:** Node.js
  - WebSocket server for LAN matches
  - HTTP API for persistence and queries
- **Database:** MongoDB

Data flow summary:
1. A match ends on the client
2. Client sends result to `POST /api/match-results`
3. Server writes a match log + updates player aggregates
4. UI fetches leaderboard via `GET /api/player-stats`

---

# Why MongoDB for this project?

- Document model fits match payloads well (players + logs + metadata).
- Flexible schema evolution for new game features.
- Fast writes for match events and chat.
- Easy leaderboard aggregation with stats documents.

**Trade-off discussed in class:**
- Document DB accelerates product iteration.
- Consistency and payload contracts require strict application-level discipline.

---

# Data model: main collections

## `match_logs`
- One document per match
- Main fields:
  - `mode`, `winner`, `players[]`, `actionLog[]`, `chatLog[]`
  - `roomCode`, `totalPlayers`, `createdAt`, `createdTimestamp`

## `player_stats`
- One document per normalized nickname (`nicknameLower` is unique)
- Main fields:
  - `wins`, `losses`, `gamesPlayed`
  - `botGames`, `humanGames`
  - `lastMode`, `lastSeenAt`, `firstSeenAt`

## `chat_messages`
- Room chat messages persisted by room code

---

# MongoDB indexes

Indexes created at server startup:

- `chat_messages`: `{ roomCode: 1, timestamp: -1 }`
- `match_logs`: `{ createdAt: -1 }`
- `match_logs`: `{ mode: 1, createdAt: -1 }`
- `player_stats`: `{ nicknameLower: 1 }` with `unique: true`
- `player_stats`: `{ wins: -1, losses: 1 }`

**Expected impact:**
- fast leaderboard reads
- efficient history queries by date/mode
- protection against logical player duplication

---

# Data writes (match result)

Endpoint: `POST /api/match-results`

Server pipeline:
1. validate payload (mode, winner, players)
2. normalize data (`nickname`, size limits, bounded logs)
3. insert document in `match_logs`
4. run `bulkWrite` on `player_stats` with `upsert`
  - `$inc` for counters
  - `$set` for current state
  - `$setOnInsert` for creation metadata

**Design point:** separation between detailed logs and aggregated stats.

---

# Data reads (leaderboard)

Endpoint: `GET /api/player-stats?limit=N`

Query:
- `find({})`
- `sort({ wins: -1, losses: 1, gamesPlayed: -1, nickname: 1 })`
- `limit(1..100)`

Response includes:
- nickname
- wins/losses/gamesPlayed
- bot/human split
- last mode and last seen timestamp

**DB Systems value:** clear example of index-optimized reads plus business ordering rules.

---

# Data quality and reliability

- Deterministic simulations + fuzzing (`scripts/simulate-rules.ts`)
- Card conservation checks (logical integrity)
- Regression scenarios for complex action cards
- Full guided tutorial scenario added for automated validation

**Lesson:** business-rule quality and data quality must evolve together.

---

# Live demo (7 min)

## Part 1 — Tutorial (class plays)
- Open the game
- Enter guided tutorial mode
- Execute a few guided steps

## Part 2 — Database
- Show in MongoDB:
  - a new document in `match_logs`
  - updated counters in `player_stats`
- Refresh leaderboard in the UI

---

# Lessons learned (Database Systems)

- Hybrid modeling works well:
  - full document for audit/history
  - aggregated document for fast queries
- Simple, well-chosen indexes already solve many performance concerns.
- Integrity is not “free” in NoSQL:
  - application-level validation
  - payload normalization
  - automated tests

---

# Academic next steps

- Build an analytics dashboard (win rate by mode and period).
- Add explicit payload schema versioning.
- Define retention/archival strategy for `match_logs`.
- Explore aggregation pipelines for near real-time metrics.

---

# References

- MongoDB documentation (CRUD, indexing, data modeling)
- Node.js + WebSocket (`ws`)
- React + TypeScript + Vite
- Database Systems course materials
- Project tests/simulations (engine + scenarios)

## Fill this in before presenting
- [ ] Repository link
- [ ] Articles/videos you used
- [ ] Credits for assets/images/cards

---

# Obrigado!

# Thank you!

Questions?  
After the slides: let’s play one tutorial round 🚀
