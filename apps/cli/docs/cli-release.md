# Sled Dog CLI: focused next release

Proposal, November 4, 2026. Repository inspected at `8c638a7` in `upstream/`. Original design milestone. The 0.2 implementation now exists; see README.md for delivered behavior and remaining live validation gates.

## Existing implementation

- `sled-dog` is a Python argparse launcher and connection wizard. It creates a virtual environment and installs dependencies during normal use, then opens Textual or Streamlit.
- `sled_dog_core.py` searches open PRs for one organization, fetches each PR's details with eight workers, and optionally looks up Jenkins by head SHA. Output dictionaries use display column names. It does not implement personal queues, review requests, or GitHub check runs and commit statuses.
- `sled_dog_config.py` stores ordinary JSON settings with restrictive permissions and tokens in macOS Keychain. One global GitHub token/API URL/org prevents independent host/account selection. Keychain writes currently put the secret in a subprocess argument; replace that mechanism.
- `sled_dog_tui.py` owns a full-screen Textual application with automatic refresh. `app.py` is an optional Streamlit dashboard. Neither should be the new CLI's runtime.
- No packaging metadata, dependency manifest, automated tests, or CI configuration were found in the inspected checkout. The search loop does not account for GitHub's 1,000-result ceiling or incomplete results. HTTP failures include raw response excerpts. The client follows URLs supplied in search results while attaching authorization headers.

Keep the existing web proposal in `PRODUCT-DIRECTION.md` separate. The CLI needs no web backend, database, Google login, workspace membership, GitHub App installation, or shared deployment. The old Streamlit UI is also independent of the future web app.

## Release purpose

A read-only personal GitHub companion: see my work, see reviews awaiting me, inspect a PR, and understand its current checks. Every invocation prints inline and exits. No alternate screen, screen clearing, background server, refresh loop, or implicit pager. No automatic installation during execution.

Keep Python, introduce an installable `sled-dog` entry point, and use argparse for command/help handling (retaining the existing parser and avoiding another dependency), Rich for finite terminal rendering, HTTPX for HTTP, and a native credential-store adapter. Package with `pyproject.toml`, support `pipx install .` / `uv tool install .`, and lock development dependencies. First supported platform: macOS with native Keychain integration. Other platforms may use explicitly supplied ephemeral credentials; advertise persistent storage only after their native backends are tested. Do not depend on an installed `gh` command.

## Command contract

```text
sled-dog                                  # help and examples, no network or setup
sled-dog auth login --host github.com      # hidden token prompt; verify /user
sled-dog auth login --host git.example.com
sled-dog auth status                       # local accounts and credential source, no secrets
sled-dog auth switch --host HOST --account LOGIN
sled-dog auth logout --host HOST --account LOGIN
sled-dog pr list --mine
sled-dog pr list --review-requested
sled-dog pr list --org acme                 # preserve organization discovery
sled-dog pr view acme/service#42
sled-dog pr view https://git.example.com/acme/service/pull/42
sled-dog pr checks acme/service#42
```

Network commands accept `--host`, `--account`, `--json`, and `--color auto|always|never`. Lists additionally accept `--repo OWNER/REPO`, `--org`, `--limit` (default 30), and `--state open|closed|all` (default open). Exactly one of `--mine`, `--review-requested`, or organization discovery is required; org/repo filters can narrow personal queues. Review requests include direct user requests and requests to teams the authenticated user belongs to, subject to token visibility; test team behavior on each supported host version.

One selected host/account per invocation in this release. Store multiple accounts per host and an active account per host. Explicit flags override saved defaults; default host is github.com. Derive the account login from authenticated identity, never a label supplied without verification. A PR URL selects its host; reject conflicts with `--host`. A `OWNER/REPO#NUMBER` reference uses the selected host. Do not infer an account from a token belonging to another host or silently fall back to another account. Cross-host aggregation is deferred.

PR details show canonical URL, host/account, title, author, state/draft, branches, head SHA, additions/deletions, labels, body, and a review summary. Preserve unknown mergeability/review information. Checks show names, sources, states, timestamps, and target links for that captured head SHA. Recheck the PR head after loading checks; label changed-head results stale and require rerun rather than presenting them as current.

## Terminal behavior

Use restrained accent color, compact headings, aligned summaries, useful whitespace, and readable status words inspired by Sentry's CLI. No emoji dependency. Render repository content as literal text, sanitize terminal control sequences and OSC links, and never interpret API text as Rich markup. Narrow terminals get stacked rows; redirected output gets plain text. Honor `NO_COLOR` in auto mode.

Illustrative output, not live repository data:

```text
My pull requests                         github.com / badenb

acme/service #42  Retry failed deliveries
  OPEN  checks: run `sled-dog pr checks acme/service#42`
  https://github.com/acme/service/pull/42

1 pull request · fetched just now
```

Avoid a per-PR detail/check request for ordinary list rows. Details and checks are fetched explicitly. Brief progress may animate only on an interactive stderr and must leave a final line; stdout contains the completed result. Empty results are a successful, explicit message. Errors explain the corrective command and distinguish expired credentials, SSO/permissions, unavailable host, rate limiting, and unsupported endpoints.

## Hosts and credentials

Map github.com to `https://api.github.com`; map Enterprise Server hosts to `https://HOST/api/v3`. Enterprise Cloud custom domains and unusual deployments can use an explicit HTTPS API base saved for that host. Validate hosts and API paths; disallow userinfo, query strings, fragments, and HTTP. Support a custom CA bundle with TLS verification always enabled. Pin an API version supported by the documented Enterprise test matrix rather than assuming every server supports the newest GitHub.com version.

Key credentials by normalized host plus verified login. Use an in-process native Keychain API/backend with no secret-bearing process arguments or plaintext fallback. Store only account metadata, defaults, API bases, and secret references in versioned JSON. Write configuration atomically with directory/file modes 0700/0600. Report malformed config instead of silently treating it as empty.

Login uses hidden input or explicit `--with-token` stdin for automation; never accept a token argument. An ephemeral `SLED_DOG_TOKEN` requires an explicitly selected host, is never persisted, and must match any explicit account via `/user`. No implicit `.env` loading or automatic use of unrelated GitHub token variables. Fail without prompting when input is noninteractive. If secure storage is unavailable, report it and offer the documented ephemeral method; do not save an insecure copy.

Construct API paths from validated owner/repo/number values. Constrain pagination to the configured API origin/path, and reject redirects rather than forwarding credentials to an untrusted destination. Redact secrets, authorization headers, and credential-bearing URLs in diagnostics. Do not print raw response bodies or unfiltered exception strings. No telemetry or persistent PR cache in this release.

Read-only product behavior does not guarantee a user's token is read-only. Document minimum endpoint permissions and recommend fine-grained read access to pull requests, checks, commit statuses, and metadata; explain team visibility and organization SSO policies. Browser OAuth/device login is deferred until an independently registered CLI application and Enterprise compatibility are established.

## Checks and JSON

Fetch both GitHub check runs and legacy commit statuses for the captured PR head SHA, with pagination. Preserve provider IDs and raw state/conclusion, and normalize to success, failure, pending, cancelled, skipped, neutral, action_required, timed_out, stale, or unknown. Deduplicate status history by context and check reruns by source identity, never just display name. No checks is `none`; missing permissions is `unavailable`. Neither means success. This release reports observed head checks, not a guarantee that every branch-protection requirement or merge-queue condition is satisfied.

Every command supports a versioned JSON envelope: `schema_version`, `data`, `meta`, and `errors`. Include selected host/account, fetch time, completeness, truncation, and pagination metadata where applicable. Unknown values are null; empty lists remain lists; timestamps are UTC ISO 8601. Auth output excludes tokens and secret references. JSON mode writes exactly one JSON document to stdout with no prompts, color, or progress, including structured errors; stderr may contain a concise human diagnostic.

Exit codes: 0 for a completed query (including empty lists or failing CI checks), 1 for operational/API failures, 2 for invalid arguments, 3 for missing/rejected authentication, 4 for incomplete/partial retrieval, and 130 for interruption. CI conclusions are data, independent of CLI execution success. Missing optional detail fields can be null with explicit warnings; a failed checks source makes the checks result partial. Reaching the caller's list limit is marked truncated, but is not an operational failure. Search API incomplete results or provider ceilings are explicitly reported and require narrowing the query; never silently claim a complete queue.

## Implementation sequence and release gates

1. Package and command skeleton; domain models; literal, finite output; JSON and error contract; help without dependencies being installed at runtime.
2. Host/account configuration, native credentials, token login, identity checks, switch/logout, and ephemeral automation path.
3. Personal/review/org lists with bounded pagination and detail retrieval. Deterministic sorting and fully qualified identities.
4. Head-SHA checks/statuses, stale-head handling, diagnostics, packaging, and usage documentation.

Use focused fixture-backed tests for CLI exit/output behavior, JSON envelopes, account isolation, URL/redirect boundaries, terminal injection, search limits, missing permissions, pagination, reruns, and a PR head changing during retrieval. Credential-adapter tests must prove secrets do not enter argv/config/output and storage failures do not silently fall back. Run authenticated smoke tests against GitHub.com and a named Enterprise Server version before claiming that version supported. Include direct and team review requests and public/private repositories. Test piped output and a real narrow terminal; assert no alternate-screen or clear-screen escape sequences.

Preserve legacy files during initial development; the new CLI must not import Textual or Streamlit. After acceptance, switch the launcher to the package and archive the dashboard instructions. Provide an explicit migration command that reads old settings, validates the host and token identity, and copies into the new schema without deleting legacy settings or tokens. Do not automatically read old `.env` files. The future web application remains separately designed and deployed.

Defer PR creation/review/merge, checkout/diffs, watch mode, all-account aggregation, direct Jenkins integration, Digital.ai ticket lookup, web synchronization, and OAuth device login. Jenkins already publishing GitHub statuses remains visible through GitHub.

## API references

- Check runs: https://docs.github.com/en/rest/checks/runs
- Legacy commit statuses: https://docs.github.com/en/rest/commits/statuses
- Search limits and incomplete results: https://docs.github.com/en/rest/search/search
