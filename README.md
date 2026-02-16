# Temporis Digital (Playtest Build)

Temporis Digital is a playable web prototype built with React + TypeScript + Vite.

## License

This project is proprietary and distributed under an **All Rights Reserved** license.
See [LICENSE](./LICENSE).

## Current playtest features

- Rule-driven card engine (event/action/paradox)
- Reaction chain with That Never Happened (counter-on-counter)
- Manual target selection for action effects
- Up to 6 players in local playtest mode (you + bots)
- LAN lobby (host/join room with nickname over WebSocket)
- Live synchronized LAN match actions across connected clients
- Snapshot + replay for late join spectators
- Nickname-based seat reconnection during active matches
- Host proxy bot takes turns for disconnected players
- Proxy actions are marked in reaction history
- Manual `Resync Snapshot` button available during LAN matches

## Run the client

```bash
npm install
npm run dev
```

## Run LAN lobby server

```bash
npm run lan:server
```

This server now requires a local MongoDB connection.

Default local values (already built in):

- `MONGO_URI=mongodb://127.0.0.1:27017`
- `MONGO_DB_NAME=temporis`

If your local MongoDB is running with default settings, no extra config is needed.

PowerShell custom example:

```bash
$env:MONGO_URI="mongodb://127.0.0.1:27017"; $env:MONGO_DB_NAME="temporis"; npm run lan:server
```

Server default:

- WebSocket URL: `ws://<HOST_IP>:8787`

You can change port with environment variable:

- PowerShell: `$env:LAN_PORT=9000; npm run lan:server`

## One-command host mode (recommended)

Start both services together (LAN WS server + network-exposed frontend):

```bash
npm run host:all
```

This launches:

- WebSocket server on `ws://<HOST_IP>:8787`
- Frontend on `http://<HOST_IP>:5173`

Host flow:

1. Run `npm run host:all`
2. Share `http://<HOST_IP>:5173` with friends
3. In-app WS URL should be `ws://<HOST_IP>:8787`

## Optimize card images (recommended for LAN)

Generate compressed WebP versions from `public/cards/*.png`:

```bash
npm run assets:optimize-cards
```

Optional quality override (default `68`):

```bash
$env:CARD_WEBP_QUALITY=62; npm run assets:optimize-cards
```

The client will prefer `public/cards_webp/*.webp` and automatically fallback to PNG if needed.

## Rule simulations (auto bug hunting)

You can run deterministic scenario checks + randomized fuzz simulations without manually playing turns.

Quick run:

```bash
npm run sim:rules:quick
```

Stress run:

```bash
npm run sim:rules:stress
```

Report run (writes JSON metrics):

```bash
npm run sim:rules:report
```

All-in-one verification (build + quick + report):

```bash
npm run verify:all
```

Replay a specific failing match seed:

```bash
npx tsx scripts/simulate-rules.ts --games 1 --maxSteps 1200 --replay-seed 695888865 --seed 123 --report --report-file reports/replay-695888865.json
```

Full run:

```bash
npm run sim:rules
```

Custom run:

```bash
npx tsx scripts/simulate-rules.ts --games 500 --maxSteps 700 --seed 12345
```

What this validates:

- known edge scenarios (e.g. Time Skip turn-flow + winner check, Rewrite Event blocked when invalid)
- state consistency (all 120 cards accounted for exactly once)
- proactive per-action card conservation check in fuzz (detects card loss before action is chosen)
- purity guard in fuzz (detects accidental mutation of the original game state)
- loop detection (repeated state signatures)
- action progression (no stuck state without valid moves)
- per-phase/action metrics when `--report` is enabled
- reproducible replay using `--replay-seed`

Current deterministic scenarios include:

- `time_skip_then_win`
- `rewrite_blocked_without_timeline`
- `present_blocked_without_discard_card`
- `time_swap_blocked_without_own_timeline`
- `rewrite_flow_returns_target_to_hand`
- `one_vs_one_time_skip_forces_extra_skip`
- `tnh_double_chain_resolves_original`
- `future_peek_canceled_by_tnh`
- `future_peek_reveals_without_tnh`
- `paradox_swap_happy_path`
- `back_in_time_only_last_targetable`
- `local_reset_happy_path`
- `time_swap_happy_path`
- `present_discard_then_draw_flow`
- `deck_empty_winner_by_tiebreak`

## Radmin VPN usage

1. Host starts `npm run lan:server`.
2. Host shares Radmin VPN IP + port `8787` with friends.
3. Each player opens the client, enters `ws://HOST_IP:8787`, chooses nickname, joins room.

## LAN sync notes

- The host starts the match and server broadcasts a deterministic seed + roster.
- Before match start, all connected players must finish card-asset preload and report ready.
- All actions are sequenced and replayed in order on every client.
- If a sequence gap is detected, the client requests a fresh snapshot automatically.
- Players who disconnect can reclaim their seat by rejoining with the same nickname.
- New users joining mid-match enter as spectators and receive current state via snapshot replay.
