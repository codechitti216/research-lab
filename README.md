# research-lab
The Kanban board of my personal research and exploration.

## Lab app
- `npm install`
- `npm run dev`

## Data model
- `data/db.json` is the master log. It is an array of entries:
  - `id`: string
  - `title`: short description of the experiment
  - `track`: `#Math` or `#Code`
  - `history`: array of `{ status, at }` where `status` is `Hypothesis`, `Sandboxing`, or `Resolved`
  - `description`: free-form Daily Delta / notes

## Sync bridge
- `npm run sync` reads `data/db.json` and `data/ledger.json`, then writes a small portfolio snapshot into `codechitti216.github.io/src/data/labSnapshot.json`.
- The portfolio only uses:
  - `latestActivity`: the most recent task-completion event from the ledger
  - `openResearchLedgerUrl`: the public read-only ledger page
  - `githubUrl`: the lab repository link
  - `syncedAt`: the time the portfolio mirror was refreshed
