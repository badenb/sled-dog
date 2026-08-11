"""Sled Dog — a Streamlit dashboard for open GitHub pull requests.

Use ``./sled-dog`` for guided setup and launch. Environment variables and a local
``.env`` file remain available as development overrides.
"""

from __future__ import annotations

from typing import Any

import pandas as pd
import requests
import streamlit as st

from sled_dog_config import resolved_settings
from sled_dog_core import dashboard_rows as load_dashboard_rows



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


def addition_style(_value: Any) -> str:
    return "color: #16a34a; font-weight: 700;"


def deletion_style(_value: Any) -> str:
    return "color: #dc2626; font-weight: 700;"


@st.cache_data(ttl=60, show_spinner=False)
def dashboard_rows(
    github_api_url: str,
    github_org: str,
    github_token: str,
    jenkins_api_url: str,
    jenkins_username: str,
    jenkins_api_token: str,
    digital_ai_enabled: bool,
) -> list[dict[str, Any]]:
    return load_dashboard_rows(
        github_api_url,
        github_org,
        github_token,
        jenkins_api_url,
        jenkins_username,
        jenkins_api_token,
        digital_ai_enabled,
    )


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

    available_labels = sorted(
        {label for row in rows for label in row.get("Labels", [])},
        key=str.casefold,
    )
    selected_labels = st.multiselect(
        "Filter by labels",
        options=available_labels,
        help="Filtering happens locally and does not make additional GitHub requests.",
    )
    match_all_labels = False
    if len(selected_labels) > 1:
        match_all_labels = st.checkbox("Require all selected labels")

    filtered_rows = rows
    if selected_labels:
        selected = set(selected_labels)
        if match_all_labels:
            filtered_rows = [
                row for row in rows if selected.issubset(set(row.get("Labels", [])))
            ]
        else:
            filtered_rows = [
                row for row in rows if selected.intersection(row.get("Labels", []))
            ]

    if not filtered_rows:
        st.info("No pull requests match the selected labels.")
        return

    display_rows = []
    for row in filtered_rows:
        display_row = dict(row)
        title = str(display_row["PR Title"]).replace("\n", " ")
        link = str(display_row.pop("Link")).split("#", 1)[0]
        display_row["PR Title"] = f"{link}#sled-dog-title={title}"
        display_row["Labels"] = ", ".join(row.get("Labels", [])) or "—"
        display_rows.append(display_row)

    table = pd.DataFrame(display_rows)
    status_column = "Jenkins Build Status"
    if jenkins_api_url:
        table[status_column] = table[status_column].map(jenkins_status_indicator)
    displayed_table = table.style.map(addition_style, subset=["Additions"]).map(
        deletion_style, subset=["Deletions"]
    )
    if jenkins_api_url:
        displayed_table = displayed_table.map(
            jenkins_status_style, subset=[status_column]
        )

    column_config = {
        "PR Title": st.column_config.LinkColumn(
            "PR Title",
            display_text=r".*#sled-dog-title=(.*)",
            width="large",
        ),
        "Repository": st.column_config.TextColumn("Repository"),
        "Labels": st.column_config.TextColumn("Labels"),
        "Additions": st.column_config.NumberColumn("Additions", format="+%d"),
        "Deletions": st.column_config.NumberColumn("Deletions", format="−%d"),
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
    count_caption = f"Showing {len(filtered_rows)} of {len(rows)} open pull request(s)."
    if selected_labels:
        match_mode = "all" if match_all_labels else "any"
        count_caption += f" Matching {match_mode} selected label(s)."
    st.caption(f"{count_caption} Data is cached for 60 seconds.")


if __name__ == "__main__":
    main()
