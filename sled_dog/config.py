"""Versioned account metadata and native-only credential storage."""
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit


class Failure(Exception):
    def __init__(self, message, code=1):
        super().__init__(message)
        self.code = code


def host_name(value):
    value = value.lower().rstrip('.')
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]+)?', value) or '..' in value:
        raise Failure('Supply a hostname, such as github.com.', 2)
    return value


def api_base(host, override=None):
    value = override or ('https://api.github.com' if host == 'github.com' else f'https://{host}/api/v3')
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise Failure('API base must be an HTTPS URL without credentials, query, or fragment.', 2)
    if any(part in ('.', '..') for part in parsed.path.split('/')) or '%' in parsed.path:
        raise Failure('Invalid API base path.', 2)
    return value.rstrip('/')


class Config:
    def __init__(self, path=None):
        if path is None:
            if sys.platform == 'darwin':
                root = Path.home() / 'Library/Application Support/Sled Dog'
            elif sys.platform == 'win32':
                root = Path(os.environ.get('APPDATA', Path.home() / 'AppData/Roaming')) / 'Sled Dog'
            else:
                root = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'sled-dog'
            path = root / 'cli-v2.json'
        self.path = Path(path)
        self.data = {'schema_version': 1, 'default_host': 'github.com', 'hosts': {}}
        if self.path.exists():
            try:
                self.data = json.loads(self.path.read_text())
                if not isinstance(self.data, dict) or self.data['schema_version'] != 1 or not isinstance(self.data['hosts'], dict):
                    raise ValueError()
                host_name(self.data.get('default_host', 'github.com'))
                for host, entry in self.data['hosts'].items():
                    if not isinstance(entry, dict):
                        raise ValueError()
                    host_name(host)
                    api_base(host, entry['api_base'])
                    if not isinstance(entry['accounts'], list) or not all(isinstance(x, str) for x in entry['accounts']):
                        raise ValueError()
                    if entry.get('active') is not None and entry['active'] not in entry['accounts']:
                        raise ValueError()
            except (OSError, ValueError, KeyError, TypeError):
                raise Failure('Cannot read CLI configuration. Repair cli-v2.json or restore a backup.') from None

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path.parent.chmod(0o700)
        name = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', dir=self.path.parent, delete=False) as stream:
                name = stream.name
                os.chmod(name, 0o600)
                json.dump(self.data, stream, indent=2)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            if name and os.path.exists(name):
                os.unlink(name)


class Secrets:
    def __init__(self):
        # Select a native backend explicitly: never accept plaintext/chained plugins.
        try:
            if sys.platform == 'darwin':
                from keyring.backends.macOS import Keyring
            elif sys.platform == 'win32':
                from keyring.backends.Windows import WinVaultKeyring as Keyring
            elif sys.platform.startswith('linux'):
                from keyring.backends.SecretService import Keyring
            else:
                raise RuntimeError()
            self.backend = Keyring()
            # Linux checks for a usable desktop Secret Service; never fall back to files.
            if sys.platform.startswith('linux'):
                self.backend.priority
        except Exception:
            raise Failure('Native credential storage unavailable. Use SLED_DOG_TOKEN with --host.', 3) from None

    def key(self, host, account):
        return f'{host}/{account.lower()}'

    def get(self, host, account):
        try:
            return self.backend.get_password('com.sled-dog.cli.v2', self.key(host, account))
        except Exception:
            raise Failure('Cannot access native credentials. Unlock your OS credential store and retry.', 3) from None

    def put(self, host, account, token):
        try:
            self.backend.set_password('com.sled-dog.cli.v2', self.key(host, account), token)
        except Exception:
            raise Failure('Cannot save native credentials; no plaintext copy was saved.', 3) from None

    def legacy(self):
        try:
            return self.backend.get_password('com.sled-dog.cli', 'github_token')
        except Exception:
            raise Failure('Cannot read legacy Keychain credentials.', 3) from None

    def delete(self, host, account):
        try:
            self.backend.delete_password('com.sled-dog.cli.v2', self.key(host, account))
        except Exception:
            raise Failure('Cannot remove native credentials. Check Keychain and retry.', 3) from None
