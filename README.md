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
- `npm run sync` reads `data/db.json`, computes sideways-movement streaks, and writes a clean `kanban.json` into the portfolio repo (`codechitti216.github.io/src/data/kanban.json`).
- The portfolio only reads `status`, `track`, and `updatedAt`:
  - `status` is always lower-case (`hypothesis`, `sandboxing`, `resolved`)
  - `track` is `Math` or `Code`, derived from `#Math`/`#Code`
  - `updatedAt` comes from the latest movement / Daily Delta

