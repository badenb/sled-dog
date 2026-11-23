# Sled Dog web

Nuxt 4 + Vue 3 + TypeScript. UI, API, auth, and database in one app.

```sh
npm install        # from the repo root
npm run dev        # http://localhost:3000
npm test && npm run typecheck && npm run build
```

Local secrets go in the repo-root `.env` (gitignored). In production, set real environment variables.

| Variable | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signs sessions. Required. |
| `BETTER_AUTH_URL` | Public URL of the app (default `http://localhost:3000`). Must match the browser origin. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth app for sign-in. Callback: `<BETTER_AUTH_URL>/api/auth/callback/github`. |
| `SLED_DOG_GITHUB_TOKEN` | Token the server uses to read pull requests (read-only repo access). Enables sync. |
| `SLED_DOG_GITHUB_API_BASE` | GitHub Enterprise API base, e.g. `https://git.corp.com/api/v3`. Default `https://api.github.com`. |
| `SLED_DOG_SYNC_INTERVAL_SECONDS` | Background sync period (default 300, `0` disables). |
| `SLED_DOG_DB_URL` | libSQL/SQLite URL (default `file:.data/sled-dog.db`). |

## GitHub sync

An owner chooses one GitHub org or a list of repos under **GitHub** in the app. Pull requests that mention a ticket (`SD-12` in the branch, title, or description) are linked to it and move it automatically:

- draft PR open → **in progress**
- non-draft PR open → **in review**
- no open PRs and at least one merged → **done**

Tickets only move forward, and `done`/`canceled` tickets are never changed by sync. Each automatic move is written to the audit log as `github-sync`. Trigger a sync from the app, or with `sled-dog server sync`.

## Tickets, trails and teams

The board columns are fixed for everyone (backlog, todo, in progress, in review, done, canceled), so every team shares one language. What changes per ticket is its **trail**: an ordered list of checkpoints (design, copy, approvals, QA) that people add, rename, reorder (drag, or the arrow buttons), and assign to a person or a **team**. Click a card to open the ticket; the URL carries `?ticket=SD-12` so it can be shared.

- **Who can complete a checkpoint:** owners and engineers can complete any of them. Anyone else (including the read-only stakeholder role) can complete a checkpoint assigned to them, or to a team they belong to, and nothing more: they still cannot rename, reassign, add, or delete. The server enforces this; the UI only hides what you cannot do.
- **Teams** are named groups (Design, Legal) that owners create on the **Team** page. Deleting a team un-assigns its checkpoints rather than deleting them.
- Completing checkpoints does **not** move the ticket between columns. When every checkpoint is done, the card offers a one-click "move to Done".
- Every change (add, rename, assign, complete, reopen, reorder, delete) is written to the audit log with who did it.

## Database

Schema is in `server/db/schema.ts`; migrations are generated with `npx drizzle-kit generate` and applied automatically at startup. Run the server from `apps/web` so it finds the `drizzle/` folder.
