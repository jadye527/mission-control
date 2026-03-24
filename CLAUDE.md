# Mission Control

Open-source dashboard for AI agent orchestration. Manage agent fleets, track tasks, monitor costs, and orchestrate workflows.

**Stack**: Next.js 16, React 19, TypeScript 5, SQLite (better-sqlite3), Tailwind CSS 3, Zustand, pnpm

## Prerequisites

- Node.js >= 22 (LTS recommended; 24.x also supported)
- pnpm (`corepack enable` to auto-install)

## Setup

```bash
pnpm install
pnpm build
```

Secrets (AUTH_SECRET, API_KEY) auto-generate on first run if not set.
Visit `http://localhost:3000/setup` to create an admin account, or set `AUTH_USER`/`AUTH_PASS` in `.env` for headless/CI seeding.

## Run

```bash
pnpm dev              # development (localhost:3003)
bash scripts/rebuild.sh   # production rebuild + restart (ALWAYS use this)
```

**Production rebuild (port 3002):** After ANY code change to MC, run `bash scripts/rebuild.sh`. This builds, copies static assets to standalone, restarts the systemd service, and health-checks. NEVER run `pnpm build` and restart separately — use the script.

**Dev (port 3003):** `pnpm dev` with hot-reload. No rebuild needed.

## Docker

```bash
docker compose up                 # zero-config
bash install.sh --docker          # full guided setup
```

Production hardening: `docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d`

## Tests

```bash
pnpm test             # unit tests (vitest)
pnpm test:e2e         # end-to-end (playwright)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
pnpm test:all         # lint + typecheck + test + build + e2e
```

## Key Directories

```
src/app/          Next.js pages + API routes (App Router)
src/components/   UI panels and shared components
src/lib/          Core logic, database, utilities
.data/            SQLite database + runtime state (gitignored)
scripts/          Install, deploy, diagnostics scripts
docs/             Documentation and guides
```

Path alias: `@/*` maps to `./src/*`

## Data Directory

Set `MISSION_CONTROL_DATA_DIR` env var to change the data location (defaults to `.data/`).
Database path: `MISSION_CONTROL_DB_PATH` (defaults to `.data/mission-control.db`).

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`)
- **No AI attribution**: Never add `Co-Authored-By` or similar trailers to commits
- **Package manager**: pnpm only (no npm/yarn)
- **Icons**: No icon libraries -- use raw text/emoji in components
- **Standalone output**: `next.config.js` sets `output: 'standalone'`

## Common Pitfalls

- **Production deploy**: ALWAYS use `bash scripts/rebuild.sh`. Never run `pnpm build` alone — static assets won't be copied and the browser will show "Application error" from stale JS chunks.
- **Gateway agent dispatch**: The gateway `agent` invoke API does NOT accept a `model` param. Model routing is handled by agent config in `openclaw.json`.
- **better-sqlite3**: Native addon -- needs rebuild when switching Node versions (`pnpm rebuild better-sqlite3`)
- **AUTH_PASS with special chars (`$`, `#`, `%`)**: Single-quote it in `.env.local` — `AUTH_PASS='my$pass'` — to prevent dotenv interpolation.
- **Gateway optional**: Set `NEXT_PUBLIC_GATEWAY_OPTIONAL=true` for standalone deployments without gateway connectivity

## Agent Change Process (MANDATORY — read before any code change)

All agents must follow this process for every MC change. Skipping any step will result in task rejection.

### Step 1 — Branch
```bash
git checkout main && git pull
git checkout -b feat/<short-description>
```
**Never commit directly to `main`.** Never edit files while on `main`.

### Step 2 — Develop on port 3003
```bash
PORT=3003 pnpm dev
```
All development and manual testing happens here. Production (port 3002) is not touched.

### Step 3 — Validation gate (all three must pass before PR)
```bash
# 1. TypeScript — zero errors required
pnpm typecheck

# 2. Build succeeds on the feature branch
pnpm build

# 3. Smoke test dev server
curl -s -o /dev/null -w "%{http_code}" http://localhost:3003/login
# Must return 200 or 307
```
If any check fails, fix it before proceeding. Do not open a PR with a failing typecheck or build.

### Step 4 — PR and hand off to Obsidian
```bash
git add -p   # stage only intentional changes
git commit -m "feat: <description>"
# Open PR or notify Obsidian via mc-report for review
mc-report comms "PR ready for review: feat/<branch> — typecheck ✓ build ✓ smoke ✓"
```
Set the MC task to `review` status. Obsidian approves before anything goes to production.

### Step 5 — Production deploy (Obsidian or Jason only)
After Obsidian approval and merge to `main`:
```bash
git checkout main && git pull
bash scripts/rebuild.sh
```
Only `scripts/rebuild.sh` is used for production. Never restart the server manually.

### Hard rules — instant task rejection if violated
- Committed directly to `main`
- Ran `pnpm build` without running `pnpm typecheck` first
- Ran `bash scripts/rebuild.sh` on a feature branch (not main)
- Edited `.data/` or the SQLite DB directly
- Added a migration that references a table not yet created by a prior migration
- Hardcoded values (roles, IDs, secrets) in auth or session code
