# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MicheLoL** — a League of Legends ranked leaderboard tracker ("Race to Masters") for a group of players. Deployed on Vercel.

## Development

No build step. This is a vanilla JS + plain HTML/CSS frontend with Vercel serverless API functions.

- **Local dev**: `vercel dev` (requires Vercel CLI and `.env.local` with env vars)
- **Deploy**: `vercel --prod` or push to main (if connected to Vercel git integration)

Required env vars (set in Vercel dashboard or `.env.local`):
- `RIOT_API_KEY` — from developer.riotgames.com
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — Vercel KV (Redis) credentials

## Architecture

**Single-page app** — `index.html` loads `style.css` and `app.js`. No bundler, no framework.

### Frontend (`app.js`)
All UI logic lives in one file (~700+ lines). Key sections (marked with comments):
- **Constants** — tier/division LP math, role display names, number line layout
- **In-memory state** — `enrichedPlayers[]`, `activeTab`, `viewMode`, `lpHistoryOpen`
- **LP Math** — `computeTotalLP(tier, rank, lp)` converts rank + LP to a single comparable integer (MASTERS_THRESHOLD = 2800)
- **Shared player list** — fetched from `/api/players` (Vercel KV), add/remove persisted server-side
- **Champion cache** — stored in `localStorage` (`rtm_champions`), 1hr TTL, invalidated on LP change
- **LP history** — stored in Vercel KV via `/api/lp-history`, up to 200 snapshots per player
- **Position history** — stored in `localStorage` (`rtm_pos_history`), 35-day window, used for weekly rank-change deltas
- **Starred players** — `localStorage` only (`rtm_starred`)
- **Custom order** — `localStorage` (`rtm_arrange_order`) for drag-to-arrange view mode
- **Views**: Cards (leaderboard/role/custom arrange), Rankings table, Number Line (visual LP race track)

### API (`/api/*.js`) — Vercel serverless functions (ES module `export default`)
| File | Purpose |
|------|---------|
| `summoner.js` | Riot account lookup (PUUID) + solo queue rank via Riot API |
| `champions.js` | Last 20 ranked matches → top 3 champions, primary role(s), win/loss streak |
| `players.js` | CRUD for player list stored in Vercel KV (`rtm_players`) |
| `lp-history.js` | Append/read LP snapshots stored in Vercel KV (`rtm_lp_history`) |
| `suggest.js` | Suggestion submission (writes to KV or external sink) |

`champions.js` fetches match-v5 serially (no parallelism) due to Riot rate limits. It degrades silently on 403 (key not approved for match-v5).

### Scripts (`/scripts/`) — unused/legacy
Files exist but are not referenced by `index.html` or `app.js`. Treat as dead code.

### Data flow on page load
1. Load player list from `/api/players`
2. For each player, fetch rank from `/api/summoner`
3. On LP change (or cache miss), fetch champion data from `/api/champions`
4. Record LP snapshots to `/api/lp-history` when LP changes
5. Render cards sorted by `computeTotalLP()` descending
