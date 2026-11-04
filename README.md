# Sled Dog CLI

Your pull requests, review requests, and check results—printed inline, then back to your shell.

Sled Dog 0.2 replaces the full-screen dashboard launcher with a read-only CLI. It supports GitHub.com and GitHub Enterprise REST hosts, multiple accounts per host, native macOS Keychain storage, and JSON for scripts. It runs independently of the proposed future web application: no backend, database, browser login, or web-app account is required.

## Install

Requires Python 3.10+. From this repository:

```sh
pipx install .
# Alternatively:
uv tool install .
```

For development:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
python -m unittest discover -s tests -v
```

The tool installer manages an isolated environment automatically. After installation, run `sled-dog` from any directory; users never activate `.venv` or clone the repository for daily use. A standalone installer/Homebrew distribution is not shipped yet.

Normal commands never create environments or install packages. `sled-dog` with no arguments prints help. For local source testing, `./sled-dog` automatically uses the checkout’s existing `.venv` when present, so activation is optional. It does not create or install that environment.

## Connect an account

```sh
sled-dog auth login --host github.com
sled-dog auth login --host github.company.com
sled-dog auth status
sled-dog auth switch --host github.com --account your-login
```

Login prompts for a token with hidden input, verifies the account through `/user`, and stores it in macOS Keychain. Logging in with a different token adds another account; `--account LOGIN` can explicitly require a matching identity. Switching changes the default host and the active account on that host. Accounts on other hosts remain available.

For Enterprise Server, the API defaults to `https://HOST/api/v3`. For a different deployment, including Enterprise Cloud custom domains, set the API base explicitly:

```sh
sled-dog auth login --host github.company.com --api-base https://github.company.com/api/v3
```

HTTPS and certificate verification are mandatory. Set `SLED_DOG_CA_BUNDLE` to a PEM CA bundle when your organization uses a private CA. Redirects are rejected; update the configured API base when a host moves.

Use a personal token that can read the repositories you need. Fine-grained tokens need read access to pull requests, checks, commit statuses, and repository metadata. Team review discovery also needs visibility into your organization teams; token and organization policies may restrict this. Classic tokens generally need `repo` for private repositories and `read:org` for team membership. Authorize organization SSO where required. The CLI makes read requests, but cannot make a broadly privileged token read-only.

Persistent credential storage is currently supported on macOS. Other systems can use the ephemeral token method below. Enterprise URL routing and responses are covered by fixtures; authenticated GitHub.com and specific Enterprise Server versions still require live validation before a published release. No Enterprise version compatibility guarantee is claimed yet.

## Daily commands

```sh
sled-dog pr list --mine
sled-dog pr list --review-requested
sled-dog pr list --mine --org acme --limit 100
sled-dog pr list --org acme --repo acme/service
sled-dog pr list --mine --state all
sled-dog pr view 'acme/service#42'
sled-dog pr checks 'acme/service#42'
sled-dog pr view https://github.company.com/acme/service/pull/42
sled-dog pr list --mine --host github.company.com --account work-login
```

Put command options after the leaf command (`list`, `view`, `checks`, `login`, etc.). Lists require `--mine`, `--review-requested`, or `--org`. Personal queues can be narrowed with `--org` and `--repo`. Default state is open; the default limit is 30, with a maximum of 1,000. Review discovery combines direct requests with requests to visible teams and removes duplicates. Unavailable team membership makes the result explicitly partial.

A PR URL selects its host; a conflicting `--host` is an error. Short references use the selected host. An invocation uses one account on one host; there is no implicit cross-account fallback or aggregation.

Lists show repository, number, title, author, state, age since creation, labels, additions/deletions, approval and comment counts, reviewers with their decisions, URL, and a colored build summary. Both personal and review-request queues include the same card details. Build lookups run for displayed PRs only, with at most four concurrent PR lookups. Use `--no-checks` for a faster list without those extra API requests. Details also show the description, branches, and head SHA. Approval counts use one latest decision per reviewer: repeated approvals count once, change requests replace approvals, dismissed reviews do not count, and a later comment-only review preserves the existing decision. Pending/unsubmitted reviews are excluded. Counts are observed review decisions, not a guarantee that approvals remain valid under branch protection after new commits.

Comment counts combine GitHub discussion comments and inline review comments, with both components exposed separately in JSON; submitted review events are not counted again as comments. Missing detail/review access shows unknown values and marks the result partial rather than inventing zeroes. Age is based on `created_at`, not the last update, and is shown in minutes, hours, or days. Detail/review requests run only for displayed PRs with up to four concurrent lookups, even with `--no-checks`.

PR cards include passing, failing, running/queued, no checks, unavailable, stale, or mixed build status, with counts by check outcome. The same summary appears in PR details. JSON exposes it as `build`, including the head SHA, observation time, counts, and any errors. Unavailable or stale build data makes the overall result partial (exit 4) while preserving the PR cards.

Checks combine GitHub check runs and legacy commit statuses for the captured head SHA, including CI providers such as Jenkins that publish statuses to GitHub. The CLI rechecks the head after retrieval and marks changed-head results stale. Missing access and no checks are distinct from success. Raw states and conclusions remain in JSON. Results describe observed head checks, not every required check, merge queue, or mergeability condition. Direct Jenkins endpoint lookup is deferred.

PR lists and details use bordered cards with colored state badges, GitHub-colored label chips, cyan repository links, and branch/change summaries. Missing labels are shown explicitly. Cards wrap to fit narrow terminals.

All output stays in terminal scrollback. Commands have no alternate screen, screen clearing, automatic refresh, implicit pager, or background service. Output wraps on narrow terminals. Use `--color never`, `--color always`, or `NO_COLOR`; redirected output is plain by default. Untrusted PR text is rendered literally with terminal controls removed.

## Automation and JSON

For one invocation without storing credentials, inject `SLED_DOG_TOKEN` through your automation's secret manager and explicitly specify `--host` (or use a PR URL with a host):

```sh
sled-dog pr list --mine --host github.com --json
sled-dog pr checks 'acme/service#42' --host github.com --json
```

The environment token overrides the saved credential, is verified through `/user`, and is never persisted. If an account is selected, its identity must match. Sled Dog does not automatically load `.env`, `GITHUB_TOKEN`, or credentials from `gh`.

For persistent scripted login, pipe secret input to `sled-dog auth login --host HOST --with-token --json`. Never pass a token as a command argument. JSON login requires `--with-token`; JSON mode never prompts.

Every operation emits one document in JSON mode:

```json
{
  "schema_version": 1,
  "data": [],
  "meta": {
    "host": "github.com",
    "account": "your-login",
    "fetched_at": "2026-11-04T20:00:00Z",
    "complete": true,
    "truncated": false,
    "provider_ceiling": false,
    "limit": 30
  },
  "errors": []
}
```

This is an illustrative empty list response. Errors also use this envelope, with `data: null` where no result exists. Metadata can include warnings; missing optional fields are null. JSON contains no progress or ANSI escapes. Help remains ordinary command help.

| Exit | Meaning |
| --- | --- |
| 0 | Completed query, including empty results or failing CI checks |
| 1 | Operational/API failure |
| 2 | Invalid arguments |
| 3 | Missing/rejected authentication or account mismatch |
| 4 | Partial/incomplete retrieval or stale checks |
| 130 | Interrupted |

Reaching your requested list limit is successful, with `truncated: true`. GitHub search timeouts are partial. The search provider ceiling is reported separately; narrow large searches. Results are limited to repositories and teams visible to the token. A successfully completed request does not prove access to every repository in an organization.

## Credentials and configuration

Non-secret metadata lives in `~/Library/Application Support/Sled Dog/cli-v2.json` on macOS, or `$XDG_CONFIG_HOME/sled-dog/cli-v2.json` (default `~/.config/sled-dog/cli-v2.json`) elsewhere. Configuration uses atomic writes, mode 0600 files, and mode 0700 directories. Tokens are isolated by host and account under the Keychain service `com.sled-dog.cli.v2`. The native backend works in-process; tokens do not enter subprocess arguments. There is no plaintext fallback, telemetry, or persistent PR cache.

`auth status` lists configured account metadata and its configured credential source; it does not test remote authentication or unlock Keychain. To remove a stored token and account:

```sh
sled-dog auth logout --host github.com --account your-login
```

Logout removes local credentials; it does not revoke the token on GitHub. Review token permissions or revoke it in GitHub settings when appropriate.

HTTP errors provide sanitized guidance without raw response bodies. All requests remain on the configured API base; provider-returned URLs and pagination links never receive tokens. Network, SSO/permissions, authentication, and rate-limit failures have distinct guidance.

## Migrating from the dashboard

The previous launcher commands `run`, `web`, `configure`, and `status` have been replaced by the commands above. Existing legacy modules are retained for reference, with their old instructions archived in [docs/legacy-dashboard.md](docs/legacy-dashboard.md). They are not imported by the new CLI and their dependencies are not installed.

To copy a legacy saved GitHub connection into the new account model on macOS:

```sh
sled-dog auth migrate --host github.company.com
```

Migration reads the old `config.json` beside `cli-v2.json` and the old Keychain token, confirms the API destination matches the host mapping, verifies the token's identity, and saves a new account. It preserves the original configuration and credentials. For a custom API mapping, configure it with `auth login --api-base` first. Migration does not read `.env`, import Jenkins secrets, or infer credentials from your project directory.

## Development and scope

The package uses argparse for finite command parsing, Rich for inline rendering, HTTPX for host-bound requests, and an explicitly selected native macOS Keychain backend. The future web app shares no runtime or authentication dependencies. The initial design is in [docs/cli-release.md](docs/cli-release.md).

Run tests with `python -m unittest discover -s tests -v`. `requirements-dev.lock` records the macOS development environment; the package metadata allows compatible dependency versions on other platforms. CI tests Python 3.10 and 3.14 on macOS and Linux using mocked HTTP and credential adapters. No tests need real credentials or mutate GitHub data.

Before publishing: exercise real GitHub.com and named Enterprise Server versions, test native Keychain login/logout, and visually check a narrow terminal. Fixture tests do not establish live server compatibility.

PR mutations, checkout/diffs, watch mode, cross-host aggregation, direct Jenkins/Digital.ai integrations, OAuth device login, and web synchronization are deferred.
