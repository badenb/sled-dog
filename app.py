"""Sled Dog — a Streamlit dashboard for open GitHub pull requests.

Use ``./sled-dog`` for guided setup and launch. Environment variables and a local
``.env`` file remain available as development overrides.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import pandas as pd
import requests
import streamlit as st

from sled_dog_config import resolved_settings


DIGITAL_AI_PATTERN = re.compile(r"[B|S]-\d+", re.IGNORECASE)
REQUEST_TIMEOUT_SECONDS = 20


def load_dotenv(path: str = ".env") -> None:
    """Load a simple .env file without adding another runtime dependency."""
    env_path = Path(path)
    if not env_path.is_file():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key:
            os.environ.setdefault(key, value)


load_dotenv()


def response_json(response: requests.Response, service: str) -> Any:
    try:
        response.raise_for_status()
    except requests.HTTPError as exc:
        detail = response.text.strip()[:300]
        raise RuntimeError(
            f"{service} returned HTTP {response.status_code}: {detail or exc}"
        ) from exc
    try:
        return response.json()
    except requests.JSONDecodeError as exc:
        raise RuntimeError(f"{service} returned a non-JSON response") from exc


def github_headers(token: str) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_open_pull_requests(
    api_url: str, organization: str, token: str
) -> list[dict[str, str]]:
    """Find all open organization PRs, then fetch each PR's head commit SHA."""
    session = requests.Session()
    session.headers.update(github_headers(token))
    search_url = f"{api_url.rstrip('/')}/search/issues"
    page = 1
    pull_requests: list[dict[str, str]] = []

    while True:
        payload = response_json(
            session.get(
                search_url,
                params={
                    "q": f"org:{organization} is:pr is:open",
                    "sort": "updated",
                    "order": "desc",
                    "per_page": 100,
                    "page": page,
                },
                timeout=REQUEST_TIMEOUT_SECONDS,
            ),
            "GitHub",
        )
        items = payload.get("items", [])
        for item in items:
            pr_api_url = item.get("pull_request", {}).get("url")
            if not pr_api_url:
                continue
            pr_payload = response_json(
                session.get(pr_api_url, timeout=REQUEST_TIMEOUT_SECONDS), "GitHub"
            )
            pull_requests.append(
                {
                    "title": str(item.get("title", "Untitled pull request")),
                    "link": str(item.get("html_url", "")),
                    "sha": str(pr_payload.get("head", {}).get("sha", "")),
                }
            )

        if len(items) < 100:
            break
        page += 1

    return pull_requests


def jenkins_status(payload: Any) -> str:
    """Normalize common Jenkins and Jenkins-proxy response shapes."""
    if not isinstance(payload, dict):
        return "Unknown"
    if payload.get("building") is True:
        return "Building"

    for key in ("result", "status", "state"):
        value = payload.get(key)
        if value:
            return str(value).replace("_", " ").title()

    builds = payload.get("builds")
    if isinstance(builds, list) and builds:
        return jenkins_status(builds[0])
    return "Unknown"


def fetch_jenkins_build_status(
    url_template: str,
    sha: str,
    username: str = "",
    api_token: str = "",
) -> str:
    if not sha:
        return "No commit SHA"
    if "{sha}" not in url_template:
        raise ValueError("JENKINS_BUILD_API_URL must contain the {sha} placeholder")

    auth = (username, api_token) if username and api_token else None
    response = requests.get(
        url_template.format(sha=sha),
        auth=auth,
        headers={"Accept": "application/json"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    if response.status_code == 404:
        return "Not found"
    return jenkins_status(response_json(response, "Jenkins"))


def jenkins_status_indicator(status: str) -> str:
    """Add a readable icon so build state never depends on color alone."""
    normalized = status.lower()
    if any(word in normalized for word in ("failure", "failed", "error")):
        icon = "❌"
    elif any(word in normalized for word in ("unstable", "warning")):
        icon = "⚠️"
    elif any(word in normalized for word in ("success", "passed", "stable")):
        icon = "✅"
    elif any(
        word in normalized
        for word in ("building", "running", "in progress", "pending", "queued")
    ):
        icon = "🔵"
    elif any(word in normalized for word in ("aborted", "cancelled", "canceled")):
        icon = "⏹️"
    else:
        icon = "⚪"
    return f"{icon} {status}"


def jenkins_status_style(status: str) -> str:
    """Return high-contrast cell colors for common Jenkins build states."""
    normalized = status.lower()
    base = "font-weight: 600; border-radius: 0.35rem;"
    if any(word in normalized for word in ("failure", "failed", "error")):
        return f"{base} background-color: #b91c1c; color: #ffffff;"
    if any(word in normalized for word in ("unstable", "warning")):
        return f"{base} background-color: #facc15; color: #422006;"
    if any(word in normalized for word in ("success", "passed", "stable")):
        return f"{base} background-color: #15803d; color: #ffffff;"
    if any(
        word in normalized
        for word in ("building", "running", "in progress", "pending", "queued")
    ):
        return f"{base} background-color: #1d4ed8; color: #ffffff;"
    return f"{base} background-color: #475569; color: #ffffff;"


@st.cache_data(ttl=60, show_spinner=False)
def dashboard_rows(
    github_api_url: str,
    github_org: str,
    github_token: str,
    jenkins_api_url: str,
    jenkins_username: str,
    jenkins_api_token: str,
    digital_ai_enabled: bool,
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for pr in fetch_open_pull_requests(github_api_url, github_org, github_token):
        ticket = DIGITAL_AI_PATTERN.search(pr["title"])
        row = {
            "PR Title": pr["title"],
            "Link": pr["link"],
        }
        if jenkins_api_url:
            try:
                build_status = fetch_jenkins_build_status(
                    jenkins_api_url,
                    pr["sha"],
                    jenkins_username,
                    jenkins_api_token,
                )
            except (requests.RequestException, RuntimeError) as exc:
                build_status = f"Error: {exc}"
            row["Jenkins Build Status"] = build_status
        if digital_ai_enabled:
            row["Digital.ai Ticket"] = ticket.group(0).upper() if ticket else "—"
        rows.append(row)
    return rows


def main() -> None:
    st.set_page_config(page_title="Sled Dog", page_icon="🐕", layout="wide")
    st.title("🐕 Sled Dog")
    st.caption("Open pull requests with optional build and ticket context")

    settings = resolved_settings()
    try:
        github_api_url = settings["github_api_url"]
        github_org = settings["github_org"]
        github_token = settings["github_token"]
        jenkins_api_url = settings["jenkins_api_url"]
        jenkins_username = settings["jenkins_username"]
        jenkins_api_token = settings["jenkins_api_token"]
        digital_ai_enabled = settings["digital_ai_enabled"]
        if not github_api_url:
            raise ValueError("Missing GitHub API URL. Run: ./sled-dog configure")
        if not github_org:
            raise ValueError("Missing GitHub organization. Run: ./sled-dog configure")
        if jenkins_api_url and "{sha}" not in jenkins_api_url:
            raise ValueError("JENKINS_BUILD_API_URL must contain the {sha} placeholder")
    except ValueError as exc:
        st.error(str(exc))
        st.info("Run ./sled-dog configure, then restart the dashboard.")
        st.stop()

    col1, col2 = st.columns([1, 5])
    with col1:
        if st.button("Refresh", type="primary", use_container_width=True):
            st.cache_data.clear()
            st.rerun()
    with col2:
        github_access = "authenticated" if github_token else "public access"
        jenkins_access = "connected" if jenkins_api_url else "not configured"
        st.write(
            f"GitHub organization: **{github_org}** ({github_access}) · "
            f"Jenkins: **{jenkins_access}** · "
            f"Digital.ai IDs: **{'enabled' if digital_ai_enabled else 'disabled'}**"
        )

    try:
        with st.spinner("Fetching open pull requests and Jenkins statuses..."):
            rows = dashboard_rows(
                github_api_url,
                github_org,
                github_token,
                jenkins_api_url,
                jenkins_username,
                jenkins_api_token,
                digital_ai_enabled,
            )
    except (requests.RequestException, RuntimeError, ValueError) as exc:
        st.error(f"Unable to load pull requests: {exc}")
        st.stop()

    if not rows:
        st.success("No open pull requests found.")
        return

    table = pd.DataFrame(rows)
    status_column = "Jenkins Build Status"
    if jenkins_api_url:
        table[status_column] = table[status_column].map(jenkins_status_indicator)
        displayed_table = table.style.map(
            jenkins_status_style, subset=[status_column]
        )
    else:
        displayed_table = table

    column_config = {
        "PR Title": st.column_config.TextColumn("PR Title"),
        "Link": st.column_config.LinkColumn("Link", display_text="Open PR ↗"),
    }
    if jenkins_api_url:
        column_config[status_column] = st.column_config.TextColumn(
            "Jenkins Build Status"
        )
    if digital_ai_enabled:
        column_config["Digital.ai Ticket"] = st.column_config.TextColumn(
            "Digital.ai Ticket"
        )

    st.dataframe(
        displayed_table,
        column_config=column_config,
        hide_index=True,
        use_container_width=True,
    )
    if jenkins_api_url:
        st.caption(
            "Jenkins legend: ✅ success · ❌ failure · ⚠️ unstable · "
            "🔵 building or queued · ⏹️ aborted · ⚪ unavailable"
        )
    st.caption(f"Showing {len(rows)} open pull request(s). Data is cached for 60 seconds.")


if __name__ == "__main__":
    main()
