"""Provider-neutral data loading for Sled Dog interfaces."""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

import requests


DIGITAL_AI_PATTERN = re.compile(r"[B|S]-\d+", re.IGNORECASE)
REQUEST_TIMEOUT_SECONDS = 20


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


def _pull_request_details(
    headers: dict[str, str], item: dict[str, Any]
) -> Optional[dict[str, Any]]:
    pr_api_url = item.get("pull_request", {}).get("url")
    if not pr_api_url:
        return None
    pr_payload = response_json(
        requests.get(
            pr_api_url,
            headers=headers,
            timeout=REQUEST_TIMEOUT_SECONDS,
        ),
        "GitHub",
    )
    repository_url = str(item.get("repository_url", ""))
    return {
        "title": str(item.get("title", "Untitled pull request")),
        "link": str(item.get("html_url", "")),
        "sha": str(pr_payload.get("head", {}).get("sha", "")),
        "repository": repository_url.rstrip("/").rsplit("/", 1)[-1],
        "labels": sorted(
            str(label.get("name", ""))
            for label in item.get("labels", [])
            if isinstance(label, dict) and label.get("name")
        ),
    }


def fetch_open_pull_requests(
    api_url: str, organization: str, token: str
) -> list[dict[str, Any]]:
    """Find open organization PRs and retrieve their latest commit SHAs."""
    session = requests.Session()
    session.headers.update(github_headers(token))
    search_url = f"{api_url.rstrip('/')}/search/issues"
    page = 1
    items: list[dict[str, Any]] = []

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
        page_items = payload.get("items", [])
        items.extend(item for item in page_items if isinstance(item, dict))
        if len(page_items) < 100:
            break
        page += 1

    pull_requests: list[dict[str, Any]] = []
    headers = github_headers(token)
    with ThreadPoolExecutor(max_workers=8) as executor:
        details_list = executor.map(
            lambda item: _pull_request_details(headers, item),
            items,
        )
        pull_requests.extend(details for details in details_list if details)
    return pull_requests


def jenkins_status(payload: Any) -> str:
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


def dashboard_rows(
    github_api_url: str,
    github_org: str,
    github_token: str,
    jenkins_api_url: str = "",
    jenkins_username: str = "",
    jenkins_api_token: str = "",
    digital_ai_enabled: bool = True,
) -> list[dict[str, Any]]:
    pull_requests = fetch_open_pull_requests(
        github_api_url, github_org, github_token
    )
    rows: list[dict[str, Any]] = [
        {
            "PR Title": pr["title"],
            "Link": pr["link"],
            "Repository": pr["repository"],
            "Labels": pr["labels"],
            "_sha": pr["sha"],
        }
        for pr in pull_requests
    ]

    if jenkins_api_url:
        def status_for(row: dict[str, Any]) -> str:
            try:
                return fetch_jenkins_build_status(
                    jenkins_api_url,
                    str(row["_sha"]),
                    jenkins_username,
                    jenkins_api_token,
                )
            except (requests.RequestException, RuntimeError) as exc:
                return f"Error: {exc}"

        with ThreadPoolExecutor(max_workers=8) as executor:
            statuses = list(executor.map(status_for, rows))
        for row, status in zip(rows, statuses):
            row["Jenkins Build Status"] = status

    if digital_ai_enabled:
        for row in rows:
            ticket = DIGITAL_AI_PATTERN.search(str(row["PR Title"]))
            row["Digital.ai Ticket"] = ticket.group(0).upper() if ticket else "—"

    for row in rows:
        row.pop("_sha", None)
    return rows
