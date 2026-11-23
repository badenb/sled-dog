"""Keeps the web app's Codex page honest. Its examples live in apps/web/app/data/codex.json; this test parses
every one with the real CLI parser (so a renamed flag fails here), and checks that every CLI command is documented
(so a new command cannot ship without a Codex entry)."""
import argparse
import json
import re
import shlex
import unittest
from pathlib import Path

from sled_dog.cli import parser
from sled_dog.config import Failure

CODEX = Path(__file__).resolve().parents[2] / 'web' / 'app' / 'data' / 'codex.json'

# Commands deliberately left out of the Codex, with the reason.
NOT_DOCUMENTED = {('auth', 'migrate')}  # one-time legacy migration, documented in docs/reference.md


def examples():
    data = json.loads(CODEX.read_text())
    for section in data['sections']:
        for item in section['items']:
            if item.get('command') and item.get('verify', True):
                yield section['id'], item['title'], item['command']


def argv_of(command):
    """The sled-dog arguments in a displayed example: drop a leading pipe (pbpaste | ...) and env assignments."""
    command = command.replace('{origin}', 'http://localhost:3000')
    tokens = shlex.split(command.split('|')[-1])
    while tokens and re.fullmatch(r'[A-Z_]+=.*', tokens[0]):
        tokens.pop(0)
    assert tokens and tokens[0] == 'sled-dog', f'example must start with sled-dog: {command!r}'
    return tokens[1:]


def cli_commands():
    """Every (command, action) the CLI defines, read from its real parser."""
    pairs = set()
    root = parser()
    for action in root._actions:
        if isinstance(action, argparse._SubParsersAction):
            for name, sub in action.choices.items():
                nested = [a for a in sub._actions if isinstance(a, argparse._SubParsersAction)]
                if nested:
                    pairs |= {(name, act) for act in nested[0].choices}
                else:
                    pairs.add((name, None))
    return pairs


class CodexTests(unittest.TestCase):
    def test_the_data_file_is_there_and_has_examples(self):
        self.assertTrue(CODEX.exists(), f'missing {CODEX}')
        self.assertGreater(len(list(examples())), 20)

    def test_every_example_is_valid_cli_syntax(self):
        bad = []
        for section, title, command in examples():
            try:
                parser().parse_args(argv_of(command))
            except (Failure, AssertionError) as error:
                bad.append(f'[{section}] {title}: {command!r} -> {error}')
        self.assertEqual(bad, [], 'Codex examples the CLI would reject:\n' + '\n'.join(bad))

    def test_every_cli_command_is_documented(self):
        covered = set()
        for _, _, command in examples():
            args = parser().parse_args(argv_of(command))
            covered.add((args.command, getattr(args, 'action', None)))
        missing = sorted(cli_commands() - covered - NOT_DOCUMENTED, key=str)
        self.assertEqual(missing, [], 'CLI commands with no Codex example (add one to apps/web/app/data/codex.json): '
                         + ', '.join(f'{c} {a}'.strip() for c, a in missing))

    def test_no_secrets_or_real_hosts_in_examples(self):
        text = CODEX.read_text()
        for pattern in (r'ghp_[A-Za-z0-9]{10,}', r'github_pat_', r'\bsd_[A-Za-z0-9_-]{20,}'):
            self.assertIsNone(re.search(pattern, text), pattern)


if __name__ == '__main__':
    unittest.main()
