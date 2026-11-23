import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from sled_dog.cli import parser, run
from sled_dog.config import Config, Failure
from sled_dog.platform import Platform, server_url, subtask_ref, ticket_ref


class Secrets:
    store = {}
    def get(self, host, account): return self.store.get((host, account))
    def put(self, host, account, token): self.store[host, account] = token


class Harness(unittest.TestCase):
    """Shared setup and helpers only: no tests live here, so subclasses do not re-run each other."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = Config(Path(self.temp.name) / 'config.json')
        self.requests = []
        env = patch.dict(os.environ, {'SLED_DOG_SERVER': 'https://dog.test', 'SLED_DOG_API_TOKEN': 'sd_secret'})
        env.start()
        self.addCleanup(env.stop)

    def factory(self, reply):
        def handler(request):
            self.requests.append(request)
            return httpx.Response(200, json=reply)
        return lambda base, token: Platform(base, token, transport=httpx.MockTransport(handler))

    def call(self, text, reply):
        args = parser().parse_args(text.split())
        return run(args, self.config, Secrets, platform_factory=self.factory(reply))

    def call_argv(self, argv, reply):
        return run(parser().parse_args(argv), self.config, Secrets, platform_factory=self.factory(reply))


class PlatformTests(Harness):
    def test_server_url_rules(self):
        self.assertEqual(server_url('http://localhost:3000/'), 'http://localhost:3000')
        for bad in ('http://dog.test', 'https://u:p@dog.test', 'https://dog.test/?x=1', 'ftp://dog.test'):
            with self.assertRaises(Failure):
                server_url(bad)

    def test_ticket_ref(self):
        self.assertEqual(ticket_ref('sd-12'), 'SD-12')
        self.assertEqual(ticket_ref('7'), 'SD-7')
        with self.assertRaises(Failure):
            ticket_ref('../x')

    def test_create_sends_token_idempotency_key_and_reports_it(self):
        result, code = self.call('ticket create Fix-it --priority high --idempotency-key k1', {'schema_version': 1, 'data': {}, 'meta': {}, 'errors': []})
        request = self.requests[0]
        self.assertEqual(code, 0)
        self.assertEqual(request.headers['authorization'], 'Bearer sd_secret')
        self.assertEqual(request.headers['idempotency-key'], 'k1')
        self.assertEqual(json.loads(request.content), {'title': 'Fix-it', 'priority': 'high'})
        self.assertEqual(result['meta']['idempotency_key'], 'k1')

    def test_dry_run_flag_is_sent_to_server(self):
        self.call('ticket update SD-3 --status done --dry-run', {'schema_version': 1, 'data': {}, 'meta': {'dry_run': True}, 'errors': []})
        self.assertEqual(self.requests[0].url.params['dry_run'], '1')
        self.assertEqual(self.requests[0].method, 'PATCH')

    def test_update_requires_a_field(self):
        with self.assertRaises(Failure):
            self.call('ticket update SD-3', {})

    def test_redirect_does_not_forward_token(self):
        def handler(request):
            return httpx.Response(302, headers={'location': 'https://evil.test/x'})
        factory = lambda base, token: Platform(base, token, transport=httpx.MockTransport(handler))
        with self.assertRaises(Failure):
            run(parser().parse_args(['ticket', 'list']), self.config, Secrets, platform_factory=factory)

    def test_auth_failure_exit_code(self):
        def handler(request):
            return httpx.Response(401)
        factory = lambda base, token: Platform(base, token, transport=httpx.MockTransport(handler))
        with self.assertRaises(Failure) as caught:
            run(parser().parse_args(['ticket', 'list']), self.config, Secrets, platform_factory=factory)
        self.assertEqual(caught.exception.code, 3)


if __name__ == '__main__':
    unittest.main()

    def test_server_sync_posts_and_reports_kind(self):
        result, code = self.call('server sync', {'schema_version': 1, 'data': [], 'meta': {'complete': True}, 'errors': []})
        self.assertEqual((self.requests[0].method, self.requests[0].url.path), ('POST', '/api/sync'))
        self.assertEqual(result['meta']['kind'], 'sync')
        self.assertEqual(code, 0)


class RenderTests(unittest.TestCase):
    def render(self, result):
        import contextlib, io
        from sled_dog.cli import render
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            render(result, 'never')
        return buffer.getvalue()

    def test_ticket_view_lists_linked_pull_requests_literally(self):
        ticket = {'id': 'SD-1', 'status': 'in_review', 'priority': 'none', 'assignee': None, 'title': 'Login',
                  'pullRequests': [{'key': 'acme/web#7', 'state': 'open', 'draft': False, 'checks': 'failure', 'reviewDecision': 'changes_requested',
                                    'title': '\x1b[31mred\x1b[0m title', 'url': 'https://github.com/acme/web/pull/7'}]}
        out = self.render({'schema_version': 1, 'data': ticket, 'meta': {'kind': 'tickets'}, 'errors': []})
        self.assertIn('acme/web#7', out)
        self.assertIn('CI failing', out)
        self.assertIn('review changes requested', out)
        self.assertNotIn('\x1b', out)  # untrusted PR titles cannot inject terminal escapes

    def test_sync_summary_shows_moves_and_errors(self):
        rows = [{'source': 'acme', 'prsSeen': 2, 'linked': 1, 'truncated': False, 'error': None,
                 'transitions': [{'ticket': 'SD-1', 'from': 'todo', 'to': 'in_review'}]},
                {'source': 'bad', 'prsSeen': 0, 'linked': 0, 'transitions': [], 'truncated': False, 'error': 'GitHub rejected SLED_DOG_GITHUB_TOKEN.'}]
        out = self.render({'schema_version': 1, 'data': rows, 'meta': {'kind': 'sync'}, 'errors': []})
        self.assertIn('SD-1: todo -> in review', out)
        self.assertIn('GitHub rejected', out)


class SubtaskTests(Harness):
    ok = {'schema_version': 1, 'data': {'ref': 'SD-12.1', 'title': 'API', 'status': 'todo', 'assignee': None, 'pullRequests': []}, 'meta': {}, 'errors': []}

    def test_subtask_ref(self):
        self.assertEqual(subtask_ref('sd-12.2'), ('SD-12', 2))
        self.assertEqual(subtask_ref('7.1'), ('SD-7', 1))
        for bad in ('SD-12', 'SD-12.0', 'SD-12.', 'SD-12.2.3', '../x'):
            with self.assertRaises(Failure):
                subtask_ref(bad)

    def test_subtask_commands_are_routed_to_the_platform_not_github(self):
        # Regression: `subtask` once fell through to the GitHub path and crashed with a generic error.
        result, code = self.call_argv(['subtask', 'add', 'SD-12', 'API changes'], self.ok)
        self.assertEqual(code, 0)
        self.assertEqual(result['meta']['kind'], 'subtasks')

    def test_add_sends_title_assignee_and_a_retry_key(self):
        result, _ = self.call_argv(['subtask', 'add', 'SD-12', 'API changes', '--assignee', 'baden', '--idempotency-key', 'k9'], self.ok)
        request = self.requests[0]
        self.assertEqual((request.method, request.url.path), ('POST', '/api/tickets/SD-12/subtasks'))
        self.assertEqual(json.loads(request.content), {'title': 'API changes', 'assignee': 'baden'})
        self.assertEqual(request.headers['idempotency-key'], 'k9')
        self.assertEqual(result['meta']['idempotency_key'], 'k9')

    def test_add_generates_a_key_when_none_is_given(self):
        result, _ = self.call_argv(['subtask', 'add', 'SD-12', 'x'], self.ok)
        self.assertTrue(self.requests[0].headers['idempotency-key'])
        self.assertEqual(result['meta']['idempotency_key'], self.requests[0].headers['idempotency-key'])

    def test_update_sends_a_partial_patch_and_dry_run(self):
        self.call_argv(['subtask', 'update', 'SD-12.2', '--status', 'in_review', '--dry-run'], self.ok)
        request = self.requests[0]
        self.assertEqual((request.method, request.url.path, request.url.params['dry_run']), ('PATCH', '/api/tickets/SD-12/subtasks/2', '1'))
        self.assertEqual(json.loads(request.content), {'status': 'in_review'})

    def test_update_empty_assignee_unassigns(self):
        self.call_argv(['subtask', 'update', 'SD-12.2', '--assignee', ''], self.ok)
        self.assertEqual(json.loads(self.requests[0].content), {'assignee': None})

    def test_update_needs_a_field_and_a_valid_reference(self):
        with self.assertRaises(Failure) as caught:
            self.call_argv(['subtask', 'update', 'SD-12.2'], self.ok)
        self.assertEqual(caught.exception.code, 2)
        with self.assertRaises(Failure):
            self.call_argv(['subtask', 'update', 'SD-12', '--title', 'x'], self.ok)

    def test_remove_sends_delete(self):
        self.call_argv(['subtask', 'remove', 'SD-12.2'], {'schema_version': 1, 'data': {'deleted': 2}, 'meta': {}, 'errors': []})
        self.assertEqual((self.requests[0].method, self.requests[0].url.path), ('DELETE', '/api/tickets/SD-12/subtasks/2'))
        self.assertNotIn('dry_run', self.requests[0].url.params)


class SubtaskRenderTests(unittest.TestCase):
    def render(self, result):
        import contextlib, io
        from sled_dog.cli import render
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            render(result, 'never')
        return buffer.getvalue()

    def test_ticket_view_lists_subtasks_with_their_pull_requests_and_strips_escapes(self):
        ticket = {'id': 'SD-12', 'status': 'in_progress', 'priority': 'none', 'assignee': None, 'title': 'Checkout', 'pullRequests': [], 'subtasks': [
            {'ref': 'SD-12.1', 'status': 'in_review', 'title': '\x1b[31mAPI\x1b[0m', 'assignee': 'baden',
             'pullRequests': [{'number': 50, 'state': 'open', 'draft': False, 'checks': 'success'}]},
            {'ref': 'SD-12.2', 'status': 'todo', 'title': 'UI', 'assignee': None, 'pullRequests': []}]}
        out = self.render({'schema_version': 1, 'data': ticket, 'meta': {'kind': 'tickets'}, 'errors': []})
        for expected in ('Subtasks', 'SD-12.1', 'in review', '@baden', '#50 open ✓', 'SD-12.2'):
            self.assertIn(expected, out)
        self.assertNotIn('\x1b', out)

    def test_dry_run_says_nothing_was_written_and_what_the_ticket_would_do(self):
        data = {'ref': 'SD-12.1', 'status': 'in_review', 'title': 'API', 'assignee': None, 'pullRequests': []}
        out = self.render({'schema_version': 1, 'data': data, 'errors': [], 'meta': {
            'kind': 'subtasks', 'dry_run': True, 'wouldMoveTicket': {'ticket': 'SD-12', 'from': 'todo', 'to': 'in_progress'}}})
        self.assertIn('Dry run: nothing was written.', out)
        self.assertIn('Would move SD-12 todo -> in progress', out)

    def test_a_real_change_reports_the_parent_moving(self):
        data = {'ref': 'SD-12.1', 'status': 'in_review', 'title': 'API', 'assignee': None, 'pullRequests': []}
        out = self.render({'schema_version': 1, 'data': data, 'errors': [], 'meta': {
            'kind': 'subtasks', 'ticketMoved': {'ticket': 'SD-12', 'from': 'in_progress', 'to': 'in_review'}}})
        self.assertIn('Ticket moved: SD-12 in progress -> in review', out)
        self.assertNotIn('Dry run', out)

    def test_remove_wording(self):
        done = self.render({'schema_version': 1, 'data': {'deleted': 2, 'ref': 'SD-12.2'}, 'errors': [], 'meta': {'kind': 'subtasks'}})
        self.assertIn('Removed SD-12.2', done)
        preview = self.render({'schema_version': 1, 'data': {'deleted': 2, 'ref': 'SD-12.2'}, 'errors': [], 'meta': {'kind': 'subtasks', 'dry_run': True}})
        self.assertIn('Would remove SD-12.2', preview)
