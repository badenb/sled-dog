"""Shared configuration and secret storage for Sled Dog."""

from __future__ import annotations

import json
import os
import platform
import subprocess
from pathlib import Path
from typing import Any


APP_NAME = "Sled Dog"
KEYCHAIN_SERVICE = "com.sled-dog.cli"
SECRET_NAMES = ("github_token", "jenkins_api_token")


def load_dotenv(path: str = ".env") -> None:
    """Load simple development overrides without another dependency."""
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


def config_directory() -> Path:
    system = platform.system()
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    if system == "Windows":
        return Path(os.getenv("APPDATA", Path.home())) / APP_NAME
    return Path(os.getenv("XDG_CONFIG_HOME", Path.home() / ".config")) / "sled-dog"


def config_path() -> Path:
    return config_directory() / "config.json"


def load_config() -> dict[str, Any]:
    path = config_path()
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def save_config(config: dict[str, Any]) -> None:
    directory = config_directory()
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)
    path = config_path()
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    path.chmod(0o600)


def keychain_available() -> bool:
    return platform.system() == "Darwin" and Path("/usr/bin/security").is_file()


def save_secret(name: str, value: str) -> None:
    if name not in SECRET_NAMES:
        raise ValueError(f"Unsupported secret name: {name}")
    if not keychain_available():
        raise RuntimeError("Secure credential storage currently requires macOS Keychain")
    subprocess.run(
        [
            "/usr/bin/security",
            "add-generic-password",
            "-a",
            name,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
            value,
            "-U",
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def load_secret(name: str) -> str:
    if name not in SECRET_NAMES or not keychain_available():
        return ""
    result = subprocess.run(
        [
            "/usr/bin/security",
            "find-generic-password",
            "-a",
            name,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def delete_secret(name: str) -> None:
    if name not in SECRET_NAMES or not keychain_available():
        return
    subprocess.run(
        [
            "/usr/bin/security",
            "delete-generic-password",
            "-a",
            name,
            "-s",
            KEYCHAIN_SERVICE,
        ],
        check=False,
        capture_output=True,
        text=True,
    )


def setting(config: dict[str, Any], env_name: str, config_name: str) -> str:
    """Resolve environment variables before saved configuration."""
    env_value = os.getenv(env_name)
    if env_value is not None:
        return env_value.strip()
    value = config.get(config_name, "")
    return str(value).strip() if value is not None else ""


def bool_setting(config: dict[str, Any], env_name: str, config_name: str) -> bool:
    env_value = os.getenv(env_name)
    if env_value is not None:
        return env_value.strip().lower() not in {"0", "false", "no", "off"}
    return bool(config.get(config_name, True))


def resolved_settings() -> dict[str, Any]:
    """Return effective settings, with environment variables taking precedence."""
    load_dotenv()
    config = load_config()
    return {
        "github_api_url": setting(config, "GITHUB_API_URL", "github_api_url"),
        "github_org": setting(config, "GITHUB_ORG", "github_org"),
        "github_token": os.getenv("GITHUB_TOKEN", "").strip()
        or load_secret("github_token"),
        "jenkins_api_url": setting(
            config, "JENKINS_BUILD_API_URL", "jenkins_api_url"
        ),
        "jenkins_username": setting(config, "JENKINS_USERNAME", "jenkins_username"),
        "jenkins_api_token": os.getenv("JENKINS_API_TOKEN", "").strip()
        or load_secret("jenkins_api_token"),
        "digital_ai_enabled": bool_setting(
            config, "DIGITAL_AI_ENABLED", "digital_ai_enabled"
        ),
    }
