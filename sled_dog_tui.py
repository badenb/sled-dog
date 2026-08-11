"""Full-screen terminal interface for Sled Dog."""

from __future__ import annotations

import subprocess
import sys
import webbrowser
from datetime import datetime
from typing import Any, Optional

import requests
from rich.text import Text
from textual import on, work
from textual.app import App, ComposeResult
from textual.containers import Horizontal
from textual.widgets import Checkbox, DataTable, Footer, Header, Input, Static

from sled_dog_config import resolved_settings
from sled_dog_core import dashboard_rows


AUTO_REFRESH_SECONDS = 60


def label_pills(labels: list[str]) -> Text:
    if not labels:
        return Text("—", style="dim")
    rendered = Text()
    for index, label in enumerate(labels):
        if index:
            rendered.append(" ")
        rendered.append(f" {label} ", style="bold white on #6d28d9")
    return rendered


def build_status(status: str) -> Text:
    normalized = status.lower()
    if any(word in normalized for word in ("failure", "failed", "error")):
        return Text(f"❌ {status}", style="bold white on #b91c1c")
    if any(word in normalized for word in ("unstable", "warning")):
        return Text(f"⚠️ {status}", style="bold #422006 on #facc15")
    if any(word in normalized for word in ("success", "passed", "stable")):
        return Text(f"✅ {status}", style="bold white on #15803d")
    if any(
        word in normalized
        for word in ("building", "running", "in progress", "pending", "queued")
    ):
        return Text(f"🔵 {status}", style="bold white on #1d4ed8")
    if any(word in normalized for word in ("aborted", "cancelled", "canceled")):
        return Text(f"⏹️ {status}", style="bold white on #475569")
    return Text(f"⚪ {status}", style="bold white on #475569")


def addition_count(value: Any) -> Text:
    return Text(f"+{int(value):,}", style="bold #4ade80")


def deletion_count(value: Any) -> Text:
    return Text(f"−{int(value):,}", style="bold #f87171")


class SledDogApp(App[Optional[str]]):
    TITLE = "Sled Dog"
    SUB_TITLE = "Pull request command center"
    ENABLE_COMMAND_PALETTE = False
    CSS = """
    Screen {
        background: #0f172a;
    }

    Header {
        background: #1e293b;
        color: white;
    }

    #connections {
        height: 3;
        padding: 1 2;
        background: #1e293b;
        color: #cbd5e1;
    }

    #filters {
        height: 3;
        padding: 0 1;
        background: #0f172a;
    }

    #label-filter {
        width: 1fr;
    }

    #match-all {
        width: 24;
        height: 3;
        padding: 1 1;
    }

    DataTable {
        height: 1fr;
        background: #0f172a;
    }

    DataTable > .datatable--header {
        background: #334155;
        color: white;
        text-style: bold;
    }

    DataTable > .datatable--cursor {
        background: #1e3a5f;
    }

    #status {
        height: 3;
        padding: 1 2;
        background: #1e293b;
        color: #cbd5e1;
    }

    Footer {
        background: #111827;
    }
    """

    BINDINGS = [
        ("q", "quit", "Quit"),
        ("r", "refresh", "Refresh"),
        ("o", "open_pr", "Open PR"),
        ("y", "copy_link", "Copy link"),
        ("l", "focus_labels", "Filter labels"),
        ("c", "configure", "Connections"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.theme = "textual-dark"
        self.settings = resolved_settings()
        self.rows: list[dict[str, Any]] = []
        self.filtered_rows: list[dict[str, Any]] = []
        self.columns = [
            "PR Title",
            "Repository",
            "Labels",
            "Additions",
            "Deletions",
        ]
        if self.settings["jenkins_api_url"]:
            self.columns.append("Jenkins Build Status")
        if self.settings["digital_ai_enabled"]:
            self.columns.append("Digital.ai Ticket")

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True, icon="🐕")
        yield Static(id="connections")
        with Horizontal(id="filters"):
            yield Input(
                placeholder="Filter labels (comma-separated; blank shows all)",
                id="label-filter",
            )
            yield Checkbox("Require all", id="match-all")
        yield DataTable(cursor_type="row", zebra_stripes=True, id="pull-requests")
        yield Static("Starting Sled Dog…", id="status")
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one("#pull-requests", DataTable)
        table.add_columns(*self.columns)
        github_access = "authenticated" if self.settings["github_token"] else "public"
        jenkins = "connected" if self.settings["jenkins_api_url"] else "skipped"
        tickets = "enabled" if self.settings["digital_ai_enabled"] else "skipped"
        self.query_one("#connections", Static).update(
            f"🐕  GitHub: [bold]{self.settings['github_org']}[/bold] ({github_access})"
            f"   •   Jenkins: [bold]{jenkins}[/bold]"
            f"   •   Digital.ai IDs: [bold]{tickets}[/bold]"
            f"   •   Auto-refresh: [bold]{AUTO_REFRESH_SECONDS}s[/bold]"
        )
        self.set_interval(AUTO_REFRESH_SECONDS, self.refresh_data)
        self.refresh_data()

    @work(thread=True, exclusive=True, group="data-refresh")
    def refresh_data(self) -> None:
        self.call_from_thread(self.set_status, "⏳ Refreshing pull requests…")
        try:
            rows = dashboard_rows(
                self.settings["github_api_url"],
                self.settings["github_org"],
                self.settings["github_token"],
                self.settings["jenkins_api_url"],
                self.settings["jenkins_username"],
                self.settings["jenkins_api_token"],
                self.settings["digital_ai_enabled"],
            )
        except (requests.RequestException, RuntimeError, ValueError) as exc:
            self.call_from_thread(self.show_refresh_error, str(exc))
            return
        self.call_from_thread(self.finish_refresh, rows)

    def set_status(self, message: str) -> None:
        self.query_one("#status", Static).update(message)

    def finish_refresh(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.apply_filters()
        now = datetime.now().strftime("%H:%M:%S")
        labels = {label for row in rows for label in row.get("Labels", [])}
        self.query_one("#status", Static).update(
            f"✓ Updated {now}   •   {len(rows)} open PR(s)"
            f"   •   {len(labels)} available label(s)"
        )

    def show_refresh_error(self, error: str) -> None:
        self.query_one("#status", Static).update(f"❌ Refresh failed: {error}")
        self.notify(error, title="Unable to refresh", severity="error")

    def apply_filters(self) -> None:
        raw_filter = self.query_one("#label-filter", Input).value
        selected = {
            label.strip().casefold()
            for label in raw_filter.split(",")
            if label.strip()
        }
        require_all = self.query_one("#match-all", Checkbox).value
        if not selected:
            filtered = self.rows
        elif require_all:
            filtered = [
                row
                for row in self.rows
                if selected.issubset(
                    {label.casefold() for label in row.get("Labels", [])}
                )
            ]
        else:
            filtered = [
                row
                for row in self.rows
                if selected.intersection(
                    {label.casefold() for label in row.get("Labels", [])}
                )
            ]
        self.filtered_rows = filtered
        self.render_table()

    def render_table(self) -> None:
        table = self.query_one("#pull-requests", DataTable)
        table.clear()
        for row in self.filtered_rows:
            cells: list[Any] = []
            for column in self.columns:
                value = row.get(column, "—")
                if column == "PR Title":
                    cells.append(Text(str(value), style="bold cyan underline"))
                elif column == "Labels":
                    cells.append(label_pills(value))
                elif column == "Additions":
                    cells.append(addition_count(value))
                elif column == "Deletions":
                    cells.append(deletion_count(value))
                elif column == "Jenkins Build Status":
                    cells.append(build_status(str(value)))
                else:
                    cells.append(str(value))
            table.add_row(*cells)
        if self.rows:
            self.query_one("#status", Static).update(
                f"Showing {len(self.filtered_rows)} of {len(self.rows)} PR(s)"
            )

    @on(Input.Changed, "#label-filter")
    def labels_changed(self, _event: Input.Changed) -> None:
        self.apply_filters()

    @on(Checkbox.Changed, "#match-all")
    def match_mode_changed(self, _event: Checkbox.Changed) -> None:
        self.apply_filters()

    @on(DataTable.RowSelected, "#pull-requests")
    def row_selected(self, _event: DataTable.RowSelected) -> None:
        self.action_open_pr()

    def selected_link(self) -> str:
        if not self.filtered_rows:
            return ""
        table = self.query_one("#pull-requests", DataTable)
        index = max(0, min(table.cursor_row, len(self.filtered_rows) - 1))
        return str(self.filtered_rows[index].get("Link", ""))

    def action_refresh(self) -> None:
        self.refresh_data()

    def action_open_pr(self) -> None:
        link = self.selected_link()
        if not link:
            self.notify("Select a pull request first.", severity="warning")
            return
        webbrowser.open(link)
        self.notify("Opened pull request in your browser.")

    def action_copy_link(self) -> None:
        link = self.selected_link()
        if not link:
            self.notify("Select a pull request first.", severity="warning")
            return
        if sys.platform == "darwin":
            subprocess.run(["pbcopy"], input=link, text=True, check=False)
            self.notify("Pull request link copied.")
        else:
            self.notify(link, title="Pull request link", timeout=10)

    def action_focus_labels(self) -> None:
        self.query_one("#label-filter", Input).focus()

    def action_configure(self) -> None:
        self.exit("configure")


def run_terminal_app() -> Optional[str]:
    return SledDogApp().run()
