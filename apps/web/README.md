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
| `SLED_DOG_ARCHIVE_INTERVAL_SECONDS` | How often finished tickets are archived (default 3600, `0` disables). |
| `SLED_DOG_DB_URL` | libSQL/SQLite URL (default `file:.data/sled-dog.db`). |

## GitHub sync

An owner chooses one GitHub org or a list of repos under **GitHub** in the app. Pull requests that reference a ticket (`SD-12` in the branch name or title, or after a keyword in the description) are linked to it and move it automatically:

- draft PR open → **in progress**
- non-draft PR open → **in review**
- no open PRs and at least one merged → **test** (merged code still needs verifying; a person moves it to **done**)

Tickets only move forward, nothing reaches `done` on its own, and `done`/`canceled` tickets are never changed by sync. Each automatic move is written to the audit log as `github-sync`. Trigger a sync from the app, or with `sled-dog server sync`.

### What links a pull request

- The **branch name** and the **title** always link: any `SD-<n>` or `SD-<n>.<m>` there is a deliberate signal.
- The **description** links only when a reference **follows a keyword**: `closes`, `fixes`, `resolves`, `part of`, `refs` (one keyword covers a list: `Fixes SD-1, SD-2 and SD-3.1`).
- A plain mention in the description does **not** link ("see SD-3", "follow-up in SD-4.2", "depends on SD-1"). Descriptions are prose, and a stray mention used to attach a PR to the wrong ticket and move it.

## Archiving finished tickets

Done and Canceled tickets pile up. After a ticket has sat closed for a while it is **archived**: it leaves the board but is never deleted, and it keeps its subtasks, trail and pull requests.

- **How long is up to the workspace.** The default is 30 days, but teams usually want a few days, so an owner can change it. The rule is a number and a unit: **days** or **business days** (Monday to Friday; weekends don't count), and `0` means never archive automatically. For example `3 business days`, `5 business days`, `2 weeks`, `30 days`.
- **Closing time.** A ticket's clock starts when it enters Done or Canceled and is cleared if it is reopened (`closedAt` in the API). Moving between Done and Canceled keeps the original time. Existing finished tickets were given their last-updated time when this shipped.
- **Automatic.** A job runs shortly after startup and then every hour. It is idempotent, audited as the `archiver` system actor, and only archives a ticket once. Times are UTC.
- **By hand.** Owners and engineers can archive a Done or Canceled ticket, and bring any archived ticket back. **Unarchiving restarts the clock**, so it is not archived again at once. Reopening an archived ticket (moving it out of Done or Canceled) returns it to the board.
- **API.** `GET /api/tickets` hides archived tickets by default; `?archived=only` or `?archived=all` includes them. `POST` and `DELETE` on `/api/tickets/SD-12/archive` archive and unarchive (both accept `?dry_run=1`). `GET`/`PUT /api/settings/archive` read and change the rule; changing it is owners only, browser sessions only, and `?dry_run=1` reports how many tickets the new rule would archive.
- **The board says when it is cut off.** It loads at most 200 tickets; if there are more it shows how many it is hiding (`meta.truncated` and `meta.total` in the list response) rather than silently dropping the oldest.

## Subtasks: several PRs on one ticket

A ticket that needs several pull requests should not move to review the moment one of them opens. Split it into **subtasks** in the ticket sheet. Each gets a reference, `SD-12.1`, `SD-12.2`, and so on; numbers are never reused. Name a branch or PR `SD-12.2-api` and it links to that subtask only. Each subtask has its own status, assignee, and PRs, and moves like a ticket does.

The ticket then **follows its subtasks**:
- Work starting on any subtask moves the ticket to **in progress**.
- It reaches **in review**, **test**, or **done** only when **every** (non-canceled) subtask has, so it is as far along as the slowest one.
- A PR that names only `SD-12` is shown on the ticket but does not drive a ticket that has subtasks. A reference to a subtask that does not exist (`SD-12.9`) is ignored rather than attached to the parent.

## Tickets, trails and teams

The board columns are fixed for everyone (backlog, todo, in progress, in review, test, done, canceled), so every team shares one language. What changes per ticket is its **trail**: an ordered list of checkpoints (design, copy, approvals, QA) that people add, rename, reorder (drag, or the arrow buttons), and assign to a person or a **team**. Click a card to open the ticket; the URL carries `?ticket=SD-12` so it can be shared.

- **Who can complete a checkpoint:** owners and engineers can complete any of them. Anyone else (including the read-only stakeholder role) can complete a checkpoint assigned to them, or to a team they belong to, and nothing more: they still cannot rename, reassign, add, or delete. The server enforces this; the UI only hides what you cannot do.
- **Teams** are named groups (Design, Legal) that owners create on the **Team** page. Deleting a team un-assigns its checkpoints rather than deleting them.
- Completing checkpoints does **not** move the ticket between columns. When every checkpoint is done, the card offers a one-click "move to Done".
- Every change (add, rename, assign, complete, reopen, reorder, delete) is written to the audit log with who did it.

## Database

Schema is in `server/db/schema.ts`; migrations are generated with `npx drizzle-kit generate` and applied automatically at startup. Run the server from `apps/web` so it finds the `drizzle/` folder.

**A migration that has been committed must never change.** Each database remembers every migration by its hash, so editing or regenerating one makes the next startup try to re-run it and fail with `table ... already exists`. To change the schema, add a **new** migration:

```sh
npx drizzle-kit generate --name what_changed
npm run db:seal        # records its checksum in drizzle/checksums.json
```

`tests/migrations.test.ts` (run in CI) fails if a sealed migration changes, if a migration is unsealed, or if the journal and SQL files disagree. If you are still iterating on a migration that has never been merged, `npm run db:seal -- --force` re-seals it; the change to `checksums.json` is then visible in review. If startup fails with `already exists` on your own database, you most likely edited an applied migration: restore the original file from git and add a new one.
