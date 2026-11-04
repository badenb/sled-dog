# 🐕 Sled Dog CLI

Your pull requests, review requests, and build results—right in your terminal. Commands print inline and return to your shell.

Works with GitHub.com and GitHub Enterprise, with multiple hosts and accounts. Python and libraries are bundled in the releases.

## 📦 Install

On macOS 15+ with Homebrew:

```sh
brew install badenb/tap/sled-dog
sled-dog --version
```

For Windows, Linux, or installation without Homebrew, use the [release downloads](https://github.com/badenb/sled-dog/releases/latest) and [installation guide](docs/reference.md#installation). On macOS/Linux, keep the downloaded executable and its `_internal` folder together.

To update:

```sh
brew update
brew upgrade badenb/tap/sled-dog
```

These are early-access builds. Publisher signing/notarization is not configured, so direct downloads may be subject to OS or workplace restrictions.

## 🔑 Connect GitHub

Use a personal access token that can read your repositories. Your organization may require SSO authorization. See [token permissions and Enterprise setup](docs/reference.md#accounts).

```sh
sled-dog auth login --host github.com
```

Paste your token, then press **Return**. Input is hidden: no characters or dots appear.

**Clipboard login on macOS:** if pasting into the hidden prompt is awkward, copy your token and run:

```sh
pbpaste | sled-dog auth login --host github.com --with-token
```

This reads the clipboard without displaying the token or putting it in shell history. Copy something else afterward to replace it in your clipboard.

For work GitHub, replace the hostname:

```sh
pbpaste | sled-dog auth login --host github.company.com --with-token
```

Enterprise Server defaults to `https://HOST/api/v3`. Custom API URLs and private certificate authorities are covered in the setup guide above.

Check or switch accounts:

```sh
sled-dog auth status
sled-dog auth switch --host github.company.com --account your-login
```

Tokens are stored in macOS Keychain, Windows Credential Manager, or Linux Secret Service. Headless Linux can use an [environment token](docs/reference.md#automation-and-json).

## ⌨️ Daily commands

| Task | Command |
| --- | --- |
| My open PRs | `sled-dog pr list --mine` |
| Reviews waiting for me | `sled-dog pr list --review-requested` |
| Full review cards | `sled-dog pr list --review-requested --cards` |
| One repository | `sled-dog pr list --review-requested --repo acme/service` |
| PR details | `sled-dog pr view 'acme/service#42'` |
| Build/check details | `sled-dog pr checks 'acme/service#42'` |
| JSON for scripts | `sled-dog pr list --mine --json` |

Review requests use compact bordered cards with author, age, URL, changes, approval/comment counts, and labels. Full cards also show build results, reviewer decisions, and update times in Eastern Time (EST/EDT). JSON timestamps stay in UTC.

Use `--host HOST --account LOGIN` to select a different connection, `--limit 10` for fewer PRs, or `--no-checks` to skip build lookups. Review queues include requests to you and your teams, subject to GitHub visibility. A PR URL also works with `pr view` and selects its host.

Get help with `sled-dog --help` or `sled-dog pr list --help`.

## Troubleshooting

- **Login appears stuck:** hidden input shows nothing. Paste and press Return, or use the macOS `pbpaste` command above.
- **Homebrew reports outdated Command Line Tools:** update them through System Settings → General → Software Update.
- **Upgrade still shows an older version:** exit any active development venv with `deactivate`, then check `command -v sled-dog` and `sled-dog --version`.
- **Connection or credential-store problems:** run `sled-dog doctor`; check your work VPN, token permissions, and organization SSO requirements.

More detail: [command behavior](docs/reference.md#commands), [JSON and exit codes](docs/reference.md#automation-and-json), [credentials and configuration](docs/reference.md#credentials), and [legacy migration](docs/reference.md#migrating-from-the-dashboard).

## Development

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e .
./sled-dog pr list --mine
.venv/bin/python -m unittest discover -s tests -v
```

The source launcher uses the checkout's existing `.venv`; shell activation is optional. The CLI runs independently of the future web app.

See the [development notes](docs/reference.md#development-and-scope) and [release process](docs/reference.md#building-and-publishing-standalone-releases) for packaging, supported platforms, and tap updates.
