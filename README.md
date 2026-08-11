# 🐕 Sled Dog

> **Your pull requests, build health, and Digital.ai tickets—all in one friendly dashboard.**

Sled Dog is a lightweight, locally run dashboard that gives teams a quick view of open pull requests across an entire GitHub organization.

| What you see | What it tells you |
| --- | --- |
| 📝 **PR Title** | What is changing |
| 🔗 **Link** | Where to review the pull request |
| 🏗️ **Jenkins Status** | Whether the latest commit is healthy |
| 🎫 **Digital.ai Ticket** | Which `B-1234` or `S-987` work item the PR belongs to |

> [!TIP]
> Run `./sled-dog` and the setup wizard handles configuration. Jenkins, Digital.ai ticket detection, and GitHub authentication can all be skipped and connected later.

Sled Dog saves ordinary settings in your macOS Application Support directory and stores tokens securely in macOS Keychain. Users do not need to create or edit a `.env` file. Environment variables remain available as an advanced option for development and automation.

## 🧭 Table of contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Setup](#setup)
- [Configuration](#configuration)
- [Using the dashboard](#using-the-dashboard)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Current limitations](#limitations)

<a id="how-it-works"></a>

## 🔄 How it works

When Sled Dog starts, it:

1. Runs a friendly connection wizard the first time you enter `./sled-dog`.
2. Stores tokens in macOS Keychain and non-secret preferences in Application Support.
3. Searches GitHub for open pull requests in the configured organization.
4. Retrieves the head commit SHA for every pull request.
5. Optionally detects Digital.ai IDs such as `B-1234` or `S-987`.
6. Optionally retrieves and normalizes Jenkins build statuses.
7. Opens the local Streamlit dashboard in your browser.

Results are cached for 60 seconds. The **Refresh** button clears the cache and immediately requests fresh data.

<a id="requirements"></a>

## 📋 Requirements

Before starting, install:

- Python 3.9 or newer
- `pip`
- macOS for secure Keychain-based token storage in this first release
- Access to the GitHub organization you want to monitor
- Optionally, a GitHub token for private repositories and higher API rate limits
- Optionally, access to a Jenkins JSON endpoint that can look up a build using a commit SHA

Sled Dog uses three runtime Python packages:

- `streamlit`
- `requests`
- `pandas` (used to color Jenkins status cells and also installed by Streamlit)

No additional UI framework is required.

> [!NOTE]
> New to Python? Follow the setup steps in order. After installation, normal use is simply `./sled-dog`.

<a id="setup"></a>

## 🚀 Setup

### 1️⃣ Download or clone the project

Place `app.py` in a directory of your choice, then open a terminal in that directory.

If this project is stored in Git, clone it and enter the project directory:

```bash
git clone <repository-url>
cd sled-dog
```

### 2️⃣ Start the launcher

Make the launcher executable if Git did not preserve its permission:

```bash
chmod +x sled-dog
```

Then run:

```bash
./sled-dog
```

That is the entire normal installation flow. On its first run, Sled Dog:

1. opens the connection wizard;
2. tests and saves the chosen providers;
3. offers to create an isolated `.venv` environment;
4. installs Streamlit, Requests, and pandas inside that environment; and
5. launches the dashboard.

Nothing is installed globally, and future runs reuse the isolated environment automatically.

### 3️⃣ Manual dependency setup *(developers only)*

Most users should skip this section. To manage the environment yourself:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install streamlit requests pandas
```

### 4️⃣ Create a GitHub token *(optional)*

Sled Dog can authenticate to GitHub using `GITHUB_TOKEN`, but the token is optional. Without one, GitHub only returns public repositories and applies a much lower API rate limit. A token is recommended and is necessary to see private repositories.

Use a token belonging to a GitHub account that can view every repository that should appear on the dashboard. The exact permissions depend on the token type and whether the organization uses SAML single sign-on.

For a fine-grained personal access token, grant access to the desired organization and repositories and provide read-only access to pull requests and repository metadata. For a classic personal access token, private repositories commonly require the `repo` scope. Public-only organizations can use a more restricted token.

If the organization enforces SAML SSO, authorize the token for that organization after creating it. Organization policies may require an administrator to approve fine-grained tokens.

> [!CAUTION]
> Keep the token private. Never commit it to Git, paste it into `app.py`, or include it in screenshots, chat messages, and logs. If a token is exposed, revoke it immediately.

Keep the token ready for the setup wizard. Input remains hidden while you paste it, and Sled Dog stores it in macOS Keychain.

### 5️⃣ Prepare the Jenkins endpoint *(optional)*

Jenkins integration is optional. When it is skipped, the dashboard still loads and hides the Jenkins status column.

Jenkins does not provide one universal commit-to-build lookup URL. When enabled, Sled Dog accepts a URL template in `JENKINS_BUILD_API_URL`. The template **must** contain the literal placeholder `{sha}`.

For each pull request, Sled Dog replaces `{sha}` with the latest commit SHA and sends an HTTP `GET` request to the resulting URL.

Example template:

```text
https://jenkins.example.com/job/my-job/commit/{sha}/api/json
```

For a pull request whose current SHA is `abc123`, Sled Dog requests:

```text
https://jenkins.example.com/job/my-job/commit/abc123/api/json
```

The endpoint can be:

- A Jenkins job or plugin endpoint that supports commit lookup
- A Jenkins API endpoint exposed by your existing pipeline setup
- An internal proxy that maps commit SHAs to Jenkins builds

The response must be JSON. Sled Dog understands these common response shapes:

```json
{"result": "SUCCESS", "building": false}
```

```json
{"status": "failure"}
```

```json
{"state": "running"}
```

It also accepts an object containing a `builds` array and reads the first build:

```json
{
  "builds": [
    {"result": "SUCCESS", "building": false}
  ]
}
```

Status selection follows this order:

1. If `building` is `true`, display `Building`.
2. Otherwise, use `result`, `status`, or `state`, whichever appears first.
3. Otherwise, inspect the first object in `builds`.
4. If no supported value exists, display `Unknown`.

An HTTP `404` response is displayed as `Not found`. Other errors appear in the affected pull request's build-status cell without preventing the rest of the table from loading.

#### 🔐 Jenkins authentication

If Jenkins permits anonymous read access, no Jenkins credentials are needed.

If authentication is required, set both `JENKINS_USERNAME` and `JENKINS_API_TOKEN`. Sled Dog sends them using HTTP basic authentication. Use a Jenkins API token instead of an account password.

If only one of these variables is set, Jenkins authentication is not sent.

<a id="configuration"></a>

## ⚙️ Configuration

### 6️⃣ Run the guided setup

Start the connection wizard:

```bash
./sled-dog configure
```

The wizard walks through GitHub, optional Jenkins integration, and optional Digital.ai ticket detection. GitHub is tested before anything is saved. Press Enter to accept a displayed default, and rerun the command whenever you want to add, skip, or update a provider.

Check the current connections without displaying secrets:

```bash
./sled-dog status
```

Sled Dog stores non-secret settings here:

```text
~/Library/Application Support/Sled Dog/config.json
```

GitHub and Jenkins tokens are stored under the `com.sled-dog.cli` service in macOS Keychain. They are never written to `config.json`.

#### 🧑‍💻 Advanced: environment variables and `.env`

The wizard is the recommended configuration method. For development and automation, Sled Dog also supports operating-system environment variables or a `.env` file in the project directory. Environment variables take precedence over settings saved by the wizard.

Create a file named `.env` next to `app.py`:

```dotenv
GITHUB_API_URL=https://api.github.com
GITHUB_ORG=your-organization
# Optional: needed for private GitHub repositories and higher rate limits.
GITHUB_TOKEN=YOUR_GITHUB_TOKEN

# Optional: omit all Jenkins settings to run without build statuses.
JENKINS_BUILD_API_URL=https://jenkins.example.com/job/my-job/commit/{sha}/api/json
JENKINS_USERNAME=your-jenkins-username
JENKINS_API_TOKEN=replace-with-your-jenkins-api-token
```

Replace every example value with the correct value for your environment.

#### 📖 Configuration reference

| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_API_URL` | Yes | Base URL for the GitHub API. Use `https://api.github.com` for GitHub.com. |
| `GITHUB_ORG` | Yes | GitHub organization login, not its display name or full URL. |
| `GITHUB_TOKEN` | No | GitHub token for private repository access and higher API rate limits. Without it, only public data is available. |
| `JENKINS_BUILD_API_URL` | No | JSON endpoint template used to look up a build. When supplied, it must contain `{sha}`. |
| `JENKINS_USERNAME` | No | Jenkins username used for HTTP basic authentication. |
| `JENKINS_API_TOKEN` | No | Jenkins API token used for HTTP basic authentication. |
| `DIGITAL_AI_ENABLED` | No | Set to `false`, `no`, `off`, or `0` to disable ticket extraction. |

#### 🏢 GitHub Enterprise Server

For GitHub Enterprise Server, set `GITHUB_API_URL` to the installation's REST API base URL. It commonly has this form:

```dotenv
GITHUB_API_URL=https://github.example.com/api/v3
```

Confirm the exact URL with your GitHub administrator.

#### 💻 Export variables without a `.env` file

On macOS or Linux:

```bash
export GITHUB_API_URL="https://api.github.com"
export GITHUB_ORG="your-organization"
# Optional integrations:
export GITHUB_TOKEN="your-token"
export JENKINS_BUILD_API_URL="https://jenkins.example.com/job/my-job/commit/{sha}/api/json"
```

On Windows PowerShell:

```powershell
$env:GITHUB_API_URL = "https://api.github.com"
$env:GITHUB_ORG = "your-organization"
# Optional integrations:
$env:GITHUB_TOKEN = "your-token"
$env:JENKINS_BUILD_API_URL = "https://jenkins.example.com/job/my-job/commit/{sha}/api/json"
```

These values normally apply only to the current terminal session.

### 7️⃣ Protect local development secrets

Add the following entries to the project's `.gitignore` before using a `.env` file:

```gitignore
.env
.venv/
__pycache__/
*.pyc
.streamlit/secrets.toml
```

Before committing changes, verify that `.env` is not tracked:

```bash
git status
```

> [!WARNING]
> If a real token is accidentally committed or shared, revoke it immediately in GitHub or Jenkins and create a replacement. Removing the token from the latest file does not remove it from Git history.

### 8️⃣ Start Sled Dog

After setup, launch Sled Dog from the project directory:

```bash
./sled-dog
```

On the first run, this command automatically starts setup if no saved configuration exists. Later runs go directly to the dashboard. You can also use the explicit command `./sled-dog run`.

For development, Streamlit can still be launched directly:

```bash
python -m streamlit run app.py
```

Streamlit will print a local URL, normally:

```text
http://localhost:8501
```

Open that URL in a browser. Streamlit usually opens it automatically.

To stop the server, return to the terminal and press `Ctrl+C`.

If Streamlit cannot be found, activate the virtual environment and reinstall the dependencies:

```bash
python -m pip install streamlit requests pandas
```

<a id="using-the-dashboard"></a>

## 🖥️ Using the dashboard

The table contains up to four columns. Optional provider columns are hidden when their integrations are skipped:

| Column | Meaning |
| --- | --- |
| **PR Title** | The title currently stored in GitHub. |
| **Link** | A clickable link that opens the pull request. |
| **Jenkins Build Status** | The normalized status returned by Jenkins; hidden when Jenkins is skipped. |
| **Digital.ai Ticket** | The first matching ticket ID in the title; hidden when detection is skipped. |

Jenkins states use both color and an icon, making them quick to scan without relying on color alone:

| Indicator | Color | State examples |
| --- | --- | --- |
| ✅ | Green | Success, passed, or stable |
| ❌ | Red | Failure, failed, or request error |
| ⚠️ | Yellow | Unstable or warning |
| 🔵 | Blue | Building, running, pending, or queued |
| ⏹️ | Gray | Aborted or cancelled |
| ⚪ | Gray | Unknown, not found, or not configured |

Click **Refresh** to clear Sled Dog's 60-second cache and reload the data. Refreshing a large organization may take time because Sled Dog retrieves details for each pull request and, when Jenkins is configured, makes one Jenkins request per pull request.

### ⌨️ Launcher commands

| Command | Purpose |
| --- | --- |
| `./sled-dog` | Configure on first run, then launch the dashboard. |
| `./sled-dog run` | Launch the dashboard. |
| `./sled-dog configure` | Add, skip, or update provider connections. |
| `./sled-dog status` | Show connection status without revealing tokens. |
| `./sled-dog --help` | Display command help. |

## 🎫 Pull request title convention

Sled Dog looks for the first ticket ID matching `[B|S]-\d+`, without regard to letter case. Expected titles include:

```text
B-1234 Add retry behavior to the payment worker
Fix S-987: prevent duplicate notifications
[B-42] Update dependency versions
```

These display `B-1234`, `S-987`, and `B-42`, respectively. A title without a match displays `—`.

<a id="troubleshooting"></a>

## 🧰 Troubleshooting

### ❓ Missing required setting

Example:

```text
Missing required setting: GITHUB_ORG
```

Only the GitHub API URL and organization are required. Run `./sled-dog configure` to supply or correct them. If you use environment variables instead, restart Sled Dog after changing them.

### 📴 The Jenkins column is missing

This is expected when Jenkins was skipped during setup. Run `./sled-dog configure` and connect Jenkins if you want build statuses; otherwise, no action is required.

### 🔗 Jenkins URL must contain `{sha}`

The URL template must include `{sha}` exactly, including the braces:

```dotenv
JENKINS_BUILD_API_URL=https://jenkins.example.com/lookup/{sha}/api/json
```

### 🔑 GitHub returns HTTP 401

The GitHub token is absent, expired, revoked, malformed, or not authorized for the organization. Create or authorize a valid token and restart the application.

### 🚧 GitHub returns HTTP 403

Common causes include:

- The token lacks access to the organization or repositories.
- SAML SSO authorization is required.
- An organization administrator has not approved the token.
- The GitHub API rate limit has been reached.

Check the message shown in the dashboard and the token's settings in GitHub.

### 🔍 Some private repositories are missing

GitHub search only returns repositories the token owner is permitted to see. Confirm both the account's repository access and the token's permissions.

### 🔎 Jenkins displays `Not found`

Jenkins returned HTTP 404 for that commit. Confirm that:

- The final generated URL is supported by your Jenkins configuration.
- A build exists for the latest pull request commit.
- The pipeline has reported or indexed that SHA.
- A reverse proxy is not rewriting or blocking the route.

### ❔ Jenkins displays `Unknown`

The endpoint returned valid JSON but did not include a recognized status field. Update the endpoint or adapt `jenkins_status()` in `app.py` to the response shape used by your Jenkins installation.

### 🔒 Jenkins returns HTTP 401 or 403

Check `JENKINS_USERNAME` and `JENKINS_API_TOKEN`. Ensure the Jenkins account has permission to read the job and its build data. Both variables must be present for Sled Dog to send authentication.

### 📜 Jenkins uses a private certificate authority

Install the organization's CA certificate for the Python environment or configure the host's certificate trust store. Do not disable TLS verification in application code; doing so exposes tokens and build data to interception.

### ⏱️ Requests time out

Each network request has a 20-second timeout. Check network access, VPN connectivity, DNS, firewall rules, proxy configuration, and the availability of GitHub and Jenkins.

### 🐌 The dashboard is slow

Sled Dog makes one GitHub detail request and one Jenkins request for every open pull request. Large organizations or slow Jenkins servers can increase load time. The 60-second cache prevents repeated requests during ordinary Streamlit reruns.

### 📦 The dependency import check fails

Activate the virtual environment and reinstall the packages:

```bash
python -m pip install --upgrade streamlit requests pandas
```

<a id="security"></a>

## 🛡️ Security recommendations

- Grant tokens only the read permissions Sled Dog needs.
- Use the setup wizard so local tokens are stored in macOS Keychain rather than a plain-text file.
- Use a dedicated service account for a shared deployment.
- Store production secrets in the deployment platform's secret manager or environment configuration rather than in a copied `.env` file.
- Never expose Sled Dog publicly without authentication and network controls. The dashboard reveals repository activity, pull request titles, build results, and internal links.
- Use HTTPS for both GitHub Enterprise and Jenkins.
- Rotate tokens according to your organization's security policy.
- Review Git history before publishing or sharing the repository.
- Do not print tokens or include them in error messages.

## 🌐 Running on a different port

Use Streamlit's command-line options:

```bash
streamlit run app.py --server.port 8502
```

To listen on all network interfaces:

```bash
streamlit run app.py --server.address 0.0.0.0
```

Listening on all interfaces can make the dashboard accessible to other machines. Apply appropriate firewall, authentication, reverse-proxy, and TLS controls before doing this on a shared network.

## 🔄 Updating Sled Dog

After replacing or modifying `app.py`:

1. Stop the running Streamlit process with `Ctrl+C`.
2. Activate the virtual environment.
3. Update dependencies if necessary.
4. Start Streamlit again.

During local development, Streamlit detects most source changes and offers to rerun the application automatically.

<a id="limitations"></a>

## 🚧 Current limitations

- This source-based preview still requires Python 3.9 or newer. A standalone executable or Homebrew package is the next step toward a dependency-free user installation.
- Secure wizard-based token persistence currently targets macOS Keychain. Windows Credential Manager and Linux Secret Service support are planned.
- The current interface launches in a browser; a full-screen terminal interface is a future option.
- Optional Jenkins commit lookup depends on an environment-specific URL template; Jenkins installations may require a plugin or proxy endpoint.
- GitHub and Jenkins calls are performed sequentially, so large result sets may load slowly.
- Only the first Digital.ai ticket ID found in a title is shown.
- The table does not currently filter by repository, author, or build state.
- Data is displayed in the browser and is not written to a database.

## 🗂️ Project structure

```text
sled-dog/
├── .streamlit/
│   └── config.toml      # Local Streamlit interface settings
├── sled-dog             # Setup wizard and application launcher
├── sled_dog_config.py   # Shared settings and macOS Keychain integration
├── app.py               # Streamlit dashboard
├── README.md            # Setup and usage documentation
└── .env                 # Optional development override; do not commit it
```
