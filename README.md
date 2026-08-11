# 🐕 Sled Dog

> **Your pull requests, build health, and Digital.ai tickets—all in one friendly dashboard.**

Sled Dog is a lightweight, single-file Streamlit dashboard that gives teams a quick view of open pull requests across an entire GitHub organization.

| What you see | What it tells you |
| --- | --- |
| 📝 **PR Title** | What is changing |
| 🔗 **Link** | Where to review the pull request |
| 🏗️ **Jenkins Status** | Whether the latest commit is healthy |
| 🎫 **Digital.ai Ticket** | Which `B-1234` or `S-987` work item the PR belongs to |

> [!TIP]
> Jenkins and GitHub authentication are optional. You can start with public GitHub data and connect more services later.

All URLs, organization names, usernames, and tokens come from environment variables or a local `.env` file. Credentials are never hard-coded in the application.

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

When the dashboard loads, Sled Dog:

1. Searches GitHub for open pull requests in the configured organization.
2. Retrieves the head commit SHA for every pull request.
3. Searches each pull request title for a Digital.ai ID matching `[B|S]-\d+`, such as `B-1234` or `S-987`.
4. If Jenkins is configured, inserts the commit SHA into its API URL.
5. Requests and normalizes the Jenkins build status, or displays `Not configured`.
6. Displays the collected information in a Streamlit table.

Results are cached for 60 seconds. The **Refresh** button clears the cache and immediately requests fresh data.

<a id="requirements"></a>

## 📋 Requirements

Before starting, install:

- Python 3.9 or newer
- `pip`
- Access to the GitHub organization you want to monitor
- Optionally, a GitHub token for private repositories and higher API rate limits
- Optionally, access to a Jenkins JSON endpoint that can look up a build using a commit SHA

Sled Dog uses three runtime Python packages:

- `streamlit`
- `requests`
- `pandas` (used to color Jenkins status cells and also installed by Streamlit)

No additional UI framework is required.

> [!NOTE]
> New to Python? Follow the setup steps in order. The virtual environment keeps everything isolated from the rest of your computer.

<a id="setup"></a>

## 🚀 Setup

### 1️⃣ Download or clone the project

Place `app.py` in a directory of your choice, then open a terminal in that directory.

If this project is stored in Git, clone it and enter the project directory:

```bash
git clone <repository-url>
cd sled-dog
```

### 2️⃣ Create a virtual environment

Using a virtual environment keeps Sled Dog's packages isolated from other Python projects.

#### 🍎 macOS or 🐧 Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
```

#### 🪟 Windows PowerShell

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
```

#### 🪟 Windows Command Prompt

```bat
py -m venv .venv
.venv\Scripts\activate.bat
```

When the environment is active, the terminal prompt will usually begin with `(.venv)`.

### 3️⃣ Install the dependencies

```bash
python -m pip install --upgrade pip
python -m pip install streamlit requests pandas
```

On systems where `python` refers to Python 2 or is not available, use `python3` instead.

Verify the installation:

```bash
python -c "import pandas, requests, streamlit; print('Dependencies installed')"
```

### 4️⃣ Create a GitHub token *(optional)*

Sled Dog can authenticate to GitHub using `GITHUB_TOKEN`, but the token is optional. Without one, GitHub only returns public repositories and applies a much lower API rate limit. A token is recommended and is necessary to see private repositories.

Use a token belonging to a GitHub account that can view every repository that should appear on the dashboard. The exact permissions depend on the token type and whether the organization uses SAML single sign-on.

For a fine-grained personal access token, grant access to the desired organization and repositories and provide read-only access to pull requests and repository metadata. For a classic personal access token, private repositories commonly require the `repo` scope. Public-only organizations can use a more restricted token.

If the organization enforces SAML SSO, authorize the token for that organization after creating it. Organization policies may require an administrator to approve fine-grained tokens.

> [!CAUTION]
> Keep the token private. Never commit it to Git, paste it into `app.py`, or include it in screenshots, chat messages, and logs. If a token is exposed, revoke it immediately.

### 5️⃣ Prepare the Jenkins endpoint *(optional)*

Jenkins integration is optional. When `JENKINS_BUILD_API_URL` is omitted, the dashboard still loads and displays `Not configured` in the Jenkins status column.

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

### 6️⃣ Configure environment variables

Sled Dog supports either operating-system environment variables or a `.env` file in the directory from which Streamlit is started. Existing operating-system variables take precedence over values in `.env`.

Create a file named `.env` next to `app.py`:

```dotenv
GITHUB_API_URL=https://api.github.com
GITHUB_ORG=your-organization
# Optional: needed for private GitHub repositories and higher rate limits.
GITHUB_TOKEN=github_pat_replace_with_your_token

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

### 7️⃣ Protect local secrets

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

From the directory containing `app.py` and `.env`, run:

```bash
streamlit run app.py
```

Streamlit will print a local URL, normally:

```text
http://localhost:8501
```

Open that URL in a browser. Streamlit usually opens it automatically.

To stop the server, return to the terminal and press `Ctrl+C`.

If the `streamlit` command cannot be found, make sure the virtual environment is active or run:

```bash
python -m streamlit run app.py
```

<a id="using-the-dashboard"></a>

## 🖥️ Using the dashboard

The table contains four columns:

| Column | Meaning |
| --- | --- |
| **PR Title** | The title currently stored in GitHub. |
| **Link** | A clickable link that opens the pull request. |
| **Jenkins Build Status** | The normalized status returned by the configured Jenkins endpoint. |
| **Digital.ai Ticket** | The first matching ticket ID in the title, or `—` if none is found. |

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

Only `GITHUB_API_URL` and `GITHUB_ORG` are required. Make sure the missing variable exists in the process environment or in a `.env` file located in the directory where you ran Streamlit. Restart Streamlit after changing the file.

### 📴 Jenkins displays `Not configured`

This is expected when `JENKINS_BUILD_API_URL` is omitted. Add the Jenkins URL template if you want build statuses; otherwise, no action is required.

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

- Optional Jenkins commit lookup depends on an environment-specific URL template; Jenkins installations may require a plugin or proxy endpoint.
- GitHub and Jenkins calls are performed sequentially, so large result sets may load slowly.
- Only the first Digital.ai ticket ID found in a title is shown.
- The table does not currently filter by repository, author, or build state.
- Data is displayed in the browser and is not written to a database.

## 🗂️ Project structure

```text
sled-dog/
├── app.py       # Complete Streamlit application
├── README.md    # Setup and usage documentation
└── .env         # Local configuration; create this file and do not commit it
```

The application itself remains entirely contained in `app.py`.
