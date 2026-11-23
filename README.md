# 🐕 Sled Dog

A developer-first project management platform. Engineers keep working in git and the terminal; Sled Dog turns that work into progress that non-technical stakeholders can read.

- **Status comes from git, not from status meetings.** A pull request that references a ticket (`SD-12` in the branch name or title, or after a keyword like `closes`, `fixes`, or `part of` in the description) links to it, and the ticket moves on its own: draft → in progress, open → in review, merged → test (a person moves it to done).
- **Built for agents as well as people.** The CLI has stable JSON output, `--dry-run` on every write, and retry-safe creates, so a coding agent can manage tickets safely.
- **Safe by default.** Invite-only workspaces, three roles, scoped API tokens that can never exceed their owner, and an audit log that separates human and agent actions.

## What's here

| Path | What it is |
| --- | --- |
| [`apps/web`](apps/web) | Web app: Nuxt 4, Vue 3, TypeScript. UI, API, sign-in, and database (SQLite). |
| [`apps/cli`](apps/cli) | The `sled-dog` command line (Python). GitHub pull requests and checks, plus tickets on a Sled Dog server. Works on its own with no server. |

## Run the web app

```sh
npm install
npm run dev          # http://localhost:3000
```

Put secrets in a `.env` file at the repo root (it is gitignored):

```
BETTER_AUTH_SECRET=...        # any long random string
GITHUB_CLIENT_ID=...          # GitHub OAuth app, for sign-in
GITHUB_CLIENT_SECRET=...
SLED_DOG_GITHUB_TOKEN=...     # optional: read-only token so the server can sync pull requests
```

1. Create a GitHub OAuth app with homepage `http://localhost:3000` and callback `http://localhost:3000/api/auth/callback/github`.
2. Sign in. **The first person to sign in becomes the workspace owner.** After that, sign-up is by invitation only (Team page).
3. Optional: under **GitHub**, add one org or a list of repos and click **Sync now** to start linking pull requests to tickets.

All environment variables, roles, and sync rules are in the [web README](apps/web/README.md).

## Roles

| Role | Can |
| --- | --- |
| **owner** | Everything, including members and GitHub sources |
| **engineer** | Create and update tickets; invite teammates |
| **stakeholder** | Read-only view of tickets and linked pull requests |

## Use the CLI

Install and GitHub setup are in the [CLI README](apps/cli/README.md). To work with tickets, create an API token on the web app's **API tokens** page, then:

```sh
echo "$TOKEN" | sled-dog server login --url http://localhost:3000 --with-token
sled-dog ticket create "Fix login redirect" --priority high
sled-dog ticket list --status in_review
sled-dog ticket view SD-12          # includes linked pull requests and CI state
sled-dog ticket update SD-12 --status done --dry-run
sled-dog server sync                # pull GitHub now
```

Add `--json` to any command for machine-readable output.

## Development

```sh
npm test                 # web tests
npm run typecheck        # web types
cd apps/cli && python3 -m venv .venv && .venv/bin/python -m pip install -e . \
  && .venv/bin/python -m unittest discover -s tests -v
```

CI runs the web checks (Node 22) and the CLI tests on pull requests that touch those apps. Standalone CLI releases are built from `apps/cli` on version tags.
