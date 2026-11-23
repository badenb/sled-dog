import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from sled_dog.cli import parser, run
from sled_dog.config import Config, Failure
from sled_dog.platform import Platform, query_from_args, resolve_step, server_url, subtask_ref, ticket_ref


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

    def routed(self, table):
        def handler(request):
            self.requests.append(request)
            reply = table.get((request.method, request.url.path))
            return httpx.Response(200, json=reply) if reply is not None else httpx.Response(404, json={})
        return lambda base, token: Platform(base, token, transport=httpx.MockTransport(handler))

    def call_routed(self, argv, table):
        return run(parser().parse_args(argv), self.config, Secrets, platform_factory=self.routed(table))

    def call_argv(self, argv, reply):
        return run(parser().parse_args(argv), self.config, Secrets, platform_factory=self.factory(reply))


class PermissionMessageTests(Harness):
    def refuse(self, status, body):
        factory = lambda base, token: Platform(base, token, transport=httpx.MockTransport(lambda request: httpx.Response(status, json=body)))
        with self.assertRaises(Failure) as caught:
            run(parser().parse_args(['ticket', 'list']), self.config, Secrets, platform_factory=factory)
        return caught.exception

    def test_a_403_shows_the_servers_reason_with_the_auth_exit_code(self):
        error = self.refuse(403, {'statusMessage': 'Only the assignee, their team, or an engineer can complete this step'})
        self.assertEqual(str(error), 'Not allowed: Only the assignee, their team, or an engineer can complete this step')
        self.assertEqual(error.code, 3)

    def test_a_403_without_a_reason_and_a_401_still_point_at_login(self):
        for status, body in ((403, {}), (401, {'statusMessage': 'Invalid or revoked token'})):
            error = self.refuse(status, body)
            self.assertIn('sled-dog server login', str(error))
            self.assertEqual(error.code, 3)

    def test_the_reason_is_length_limited_and_only_a_string_is_trusted(self):
        self.assertLessEqual(len(str(self.refuse(403, {'statusMessage': 'x' * 5000}))), 220)
        self.assertIn('server login', str(self.refuse(403, {'statusMessage': {'nested': 'object'}})))


class ServerReasonTests(Harness):
    def refuse(self, status, body):
        factory = lambda base, token: Platform(base, token, transport=httpx.MockTransport(lambda request: httpx.Response(status, json=body)))
        with self.assertRaises(Failure) as caught:
            run(parser().parse_args(['ticket', 'list']), self.config, Secrets, platform_factory=factory)
        return caught.exception

    def test_a_409_shows_why_with_exit_code_1(self):
        error = self.refuse(409, {'statusMessage': 'That ticket is already archived'})
        self.assertEqual((str(error), error.code), ('Conflict: That ticket is already archived', 1))

    def test_a_400_shows_the_servers_reason_with_the_usage_exit_code(self):
        error = self.refuse(400, {'statusMessage': 'Use at most 8 search terms'})
        self.assertEqual((str(error), error.code), ('Server rejected the request: Use at most 8 search terms', 2))

    def test_without_a_reason_the_old_messages_remain(self):
        self.assertEqual(str(self.refuse(400, {})), 'Server rejected the request: check field values.')
        self.assertEqual(str(self.refuse(409, {})), 'Server request failed (HTTP 409).')

    def test_only_a_short_string_is_ever_shown(self):
        self.assertLessEqual(len(str(self.refuse(409, {'statusMessage': 'x' * 5000}))), 220)
        self.assertEqual(str(self.refuse(409, {'statusMessage': {'a': 1}})), 'Server request failed (HTTP 409).')


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

    def test_a_sync_note_is_shown_under_its_source(self):
        rows = [{'source': 'acme', 'prsSeen': 0, 'linked': 0, 'transitions': [], 'truncated': False, 'error': None,
                 'note': "GitHub's search can lag a few seconds behind a brand-new pull request."}]
        out = self.render({'schema_version': 1, 'data': rows, 'meta': {'kind': 'sync'}, 'errors': []})
        self.assertIn('acme: 0 PR(s) seen', out)
        self.assertIn('search can lag', ' '.join(out.split()))

    def test_a_note_is_untrusted_text_like_everything_else(self):
        rows = [{'source': 'acme', 'prsSeen': 0, 'linked': 0, 'transitions': [], 'truncated': False, 'error': None, 'note': '\x1b[31mred\x1b[0m note'}]
        out = self.render({'schema_version': 1, 'data': rows, 'meta': {'kind': 'sync'}, 'errors': []})
        self.assertNotIn('\x1b', out)

    def test_no_note_means_no_extra_line(self):
        rows = [{'source': 'acme/web', 'prsSeen': 0, 'linked': 0, 'transitions': [], 'truncated': False, 'error': None, 'note': None}]
        out = self.render({'schema_version': 1, 'data': rows, 'meta': {'kind': 'sync'}, 'errors': []})
        self.assertNotIn('lag', out)

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


def env(data, meta=None):
    return {'schema_version': 1, 'data': data, 'meta': meta or {}, 'errors': []}


STEPS = [
    {'id': 13, 'position': 3, 'title': 'Legal approval', 'status': 'todo', 'assignee': None, 'team': {'id': 't2', 'name': 'Legal'}},
    {'id': 11, 'position': 1, 'title': 'Design', 'status': 'done', 'assignee': None, 'team': {'id': 't1', 'name': 'Design'}, 'completedBy': 'Dee', 'completedAt': '2026-11-20T10:00:00Z'},
    {'id': 12, 'position': 2, 'title': 'Copy review', 'status': 'todo', 'assignee': {'id': 'u3', 'name': 'Baden'}, 'team': None},
]
TICKET = ('GET', '/api/tickets/SD-12')
TABLE = {
    TICKET: env({'id': 'SD-12', 'steps': STEPS}),
    ('GET', '/api/teams'): env([{'id': 't1', 'name': 'Design', 'members': []}, {'id': 't2', 'name': 'Legal', 'members': []}]),
    ('GET', '/api/members'): env([
        {'id': 'u1', 'name': 'Dana Lee', 'email': 'dana@x.com', 'role': 'stakeholder'},
        {'id': 'u2', 'name': 'Dana Smith', 'email': 'dsmith@x.com', 'role': 'engineer'},
        {'id': 'u3', 'name': 'Baden', 'email': 'baden@x.com', 'role': 'owner'}]),
    ('POST', '/api/tickets/SD-12/steps'): env({'id': 99, 'position': 4, 'title': 'QA', 'status': 'todo', 'assignee': None, 'team': None}),
    ('PATCH', '/api/tickets/SD-12/steps/12'): env({'id': 12, 'position': 2, 'title': 'Copy review', 'status': 'done', 'assignee': None, 'team': None}),
    ('DELETE', '/api/tickets/SD-12/steps/12'): env({'deleted': 12, 'title': 'Copy review'}),
}


class ResolveStepTests(unittest.TestCase):
    def test_by_number_uses_the_order_ticket_view_shows_not_the_list_order(self):
        self.assertEqual(resolve_step(STEPS, '1')['title'], 'Design')
        self.assertEqual(resolve_step(STEPS, '3')['title'], 'Legal approval')

    def test_by_name_exact_then_unique_substring_case_insensitively(self):
        self.assertEqual(resolve_step(STEPS, 'design')['id'], 11)
        self.assertEqual(resolve_step(STEPS, 'legal')['id'], 13)
        self.assertEqual(resolve_step(STEPS, 'COPY REVIEW')['id'], 12)

    def test_ambiguous_missing_and_out_of_range_are_clear_usage_errors(self):
        for ref, expect in (('e', 'matches several'), ('nope', 'No step matches'), ('9', 'no step 9')):
            with self.assertRaises(Failure) as caught:
                resolve_step(STEPS, ref)
            self.assertIn(expect, str(caught.exception))
            self.assertEqual(caught.exception.code, 2)


class StepCommandTests(Harness):
    def test_add_resolves_the_team_and_person_by_name_and_sends_a_retry_key(self):
        result, code = self.call_routed(['step', 'add', 'SD-12', 'QA', '--team', 'design', '--assignee', 'baden', '--idempotency-key', 'k1'], TABLE)
        post = [r for r in self.requests if r.method == 'POST'][0]
        self.assertEqual(json.loads(post.content), {'title': 'QA', 'teamId': 't1', 'assigneeId': 'u3'})
        self.assertEqual(post.headers['idempotency-key'], 'k1')
        self.assertEqual((code, result['meta']['kind'], result['meta']['idempotency_key']), (0, 'steps', 'k1'))

    def test_add_with_an_unknown_team_fails_before_writing_anything(self):
        with self.assertRaises(Failure) as caught:
            self.call_routed(['step', 'add', 'SD-12', 'QA', '--team', 'Marketing'], TABLE)
        self.assertIn('Teams: Design, Legal', str(caught.exception))
        self.assertFalse([r for r in self.requests if r.method == 'POST'])

    def test_an_ambiguous_person_is_refused_not_guessed(self):
        with self.assertRaises(Failure) as caught:
            self.call_routed(['step', 'add', 'SD-12', 'QA', '--assignee', 'dana'], TABLE)
        self.assertIn('matches several people', str(caught.exception))
        self.assertEqual(self.call_routed(['step', 'add', 'SD-12', 'QA', '--assignee', 'dsmith@x.com'], TABLE)[1], 0)  # an exact email is never ambiguous
        self.assertEqual(self.call_routed(['step', 'add', 'SD-12', 'QA', '--assignee', 'Smith'], TABLE)[1], 0)  # a unique name part works

    def test_done_looks_up_the_step_then_patches_it_and_reports_its_number(self):
        result, _ = self.call_routed(['step', 'done', 'SD-12', 'copy'], TABLE)
        patch = [r for r in self.requests if r.method == 'PATCH'][0]
        self.assertEqual((patch.url.path, json.loads(patch.content)), ('/api/tickets/SD-12/steps/12', {'status': 'done'}))
        self.assertEqual(result['meta']['step_number'], 2)

    def test_reopen_sends_todo_and_dry_run_is_passed_to_the_server(self):
        self.call_routed(['step', 'reopen', 'SD-12', '2', '--dry-run'], TABLE)
        patch = [r for r in self.requests if r.method == 'PATCH'][0]
        self.assertEqual(json.loads(patch.content), {'status': 'todo'})
        self.assertEqual(patch.url.params['dry_run'], '1')

    def test_assign_to_a_team_clears_the_person_and_the_reverse(self):
        self.call_routed(['step', 'assign', 'SD-12', '2', '--team', 'Legal'], TABLE)
        self.assertEqual(json.loads([r for r in self.requests if r.method == 'PATCH'][-1].content), {'teamId': 't2', 'assigneeId': None})
        self.requests.clear()
        self.call_routed(['step', 'assign', 'SD-12', '2', '--assignee', 'baden'], TABLE)
        self.assertEqual(json.loads([r for r in self.requests if r.method == 'PATCH'][-1].content), {'assigneeId': 'u3', 'teamId': None})
        self.requests.clear()
        self.call_routed(['step', 'assign', 'SD-12', '2', '--unassign'], TABLE)
        self.assertEqual(json.loads([r for r in self.requests if r.method == 'PATCH'][-1].content), {'assigneeId': None, 'teamId': None})

    def test_assign_needs_exactly_one_target(self):
        for argv in (['step', 'assign', 'SD-12', '2'], ['step', 'assign', 'SD-12', '2', '--team', 'Legal', '--unassign']):
            with self.assertRaises(Failure) as caught:
                parser().parse_args(argv)
            self.assertEqual(caught.exception.code, 2)

    def test_remove_sends_delete(self):
        self.call_routed(['step', 'remove', 'SD-12', 'Copy review'], TABLE)
        self.assertEqual([(r.method, r.url.path) for r in self.requests][-1], ('DELETE', '/api/tickets/SD-12/steps/12'))

    def test_a_step_that_does_not_exist_makes_no_write(self):
        with self.assertRaises(Failure):
            self.call_routed(['step', 'done', 'SD-12', '7'], TABLE)
        self.assertFalse([r for r in self.requests if r.method in ('PATCH', 'POST', 'DELETE')])


class TrailRenderTests(unittest.TestCase):
    def render(self, result):
        import contextlib, io
        from sled_dog.cli import render
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            render(result, 'never')
        return buffer.getvalue()

    def view(self, steps):
        ticket = {'id': 'SD-12', 'status': 'in_progress', 'priority': 'none', 'assignee': None, 'title': 'Launch', 'pullRequests': [], 'subtasks': [], 'steps': steps}
        return self.render({'schema_version': 1, 'data': ticket, 'meta': {'kind': 'tickets'}, 'errors': []})

    def test_ticket_view_shows_a_numbered_trail_with_where_you_are(self):
        out = self.view(STEPS)
        for expected in ('Trail', '1 of 3 checkpoints', '1. ✓ Design', '👥 Design', 'done by Dee', '2. ● Copy review', '@Baden', '← you are here', '3. ○ Legal approval', '👥 Legal'):
            self.assertIn(expected, out)
        self.assertLess(out.index('1. ✓'), out.index('2. ●'))
        self.assertLess(out.index('2. ●'), out.index('3. ○'))

    def test_a_finished_trail_shows_the_flag_and_no_pointer(self):
        done = [dict(s, status='done', completedBy='X') for s in STEPS]
        out = self.view(done)
        self.assertIn('3 of 3 checkpoints  🏁', out)
        self.assertNotIn('you are here', out)

    def test_step_titles_are_untrusted_text(self):
        out = self.view([dict(STEPS[0], title='\x1b[31mred\x1b[0m step')])
        self.assertNotIn('\x1b', out)
        self.assertIn('red step', out)

    def test_a_ticket_with_no_trail_prints_no_trail_section(self):
        self.assertNotIn('Trail', self.view([]))

    def test_step_command_output(self):
        step = dict(STEPS[0], status='done', completedBy='Eli')  # Legal approval, step 3
        out = self.render({'schema_version': 1, 'data': step, 'errors': [], 'meta': {'kind': 'steps', 'step_number': 3, 'dry_run': True}})
        self.assertIn('3. ✓ Legal approval', out)
        self.assertIn('Dry run: nothing was written.', out)
        todo = self.render({'schema_version': 1, 'data': STEPS[2], 'errors': [], 'meta': {'kind': 'steps', 'step_number': 2}})
        self.assertIn('2. ○ Copy review', todo)
        self.assertNotIn('you are here', todo)  # a lone step is not "where you are" in the trail
        gone = self.render({'schema_version': 1, 'data': {'deleted': 12, 'title': 'Copy review'}, 'errors': [], 'meta': {'kind': 'steps'}})
        self.assertIn('Removed step "Copy review"', gone)


class QueryFromArgsTests(unittest.TestCase):
    def test_separate_words_stay_separate_terms(self):
        self.assertEqual(query_from_args(['login', 'redirect']), 'login redirect')

    def test_a_shell_quoted_phrase_arrives_as_one_argument_and_is_quoted_again(self):
        self.assertEqual(query_from_args(['third-party cookies']), '"third-party cookies"')
        self.assertEqual(query_from_args(['fix', 'third party cookies', 'safari']), 'fix "third party cookies" safari')

    def test_quotes_the_person_typed_on_purpose_are_left_alone(self):
        self.assertEqual(query_from_args(['"login redirect" safari']), '"login redirect" safari')
        self.assertEqual(query_from_args(['"exact phrase"']), '"exact phrase"')

    def test_blank_input_is_blank(self):
        self.assertEqual(query_from_args(['  ']), '')
        self.assertEqual(query_from_args(['', ' ', 'login']), 'login')


class SearchCommandTests(Harness):
    found = env([{'id': 'SD-1', 'status': 'done', 'title': 'Fix login', 'archivedAt': None, 'matchedIn': ['title'], 'snippet': None}], {'q': 'login', 'total': 1})

    def test_search_joins_words_and_looks_at_archived_tickets_by_default(self):
        result, code = self.call_argv(['ticket', 'search', 'login', 'redirect'], self.found)
        request = self.requests[0]
        self.assertEqual((request.method, request.url.path), ('GET', '/api/search'))
        self.assertEqual(dict(request.url.params), {'q': 'login redirect', 'archived': 'all', 'limit': '30'})
        self.assertEqual((code, result['meta']['kind']), (0, 'search'))

    def test_a_quoted_phrase_reaches_the_server_as_a_phrase(self):
        self.call_argv(['ticket', 'search', 'third-party cookies'], self.found)
        self.assertEqual(self.requests[0].url.params['q'], '"third-party cookies"')

    def test_scope_filters_map_to_the_servers_archived_modes(self):
        for flags, expected in ((['--archived'], 'only'), (['--live'], 'exclude'), ([], 'all')):
            self.requests.clear()
            self.call_argv(['ticket', 'search', 'x'] + flags, self.found)
            self.assertEqual(self.requests[0].url.params['archived'], expected, flags)

    def test_archived_and_live_together_are_refused(self):
        with self.assertRaises(Failure) as caught:
            parser().parse_args(['ticket', 'search', 'x', '--archived', '--live'])
        self.assertEqual(caught.exception.code, 2)

    def test_status_assignee_and_limit_are_passed_through_and_the_limit_is_bounded(self):
        self.call_argv(['ticket', 'search', 'x', '--status', 'done', '--assignee', 'baden', '--limit', '5'], self.found)
        self.assertEqual(dict(self.requests[0].url.params), {'q': 'x', 'status': 'done', 'assignee': 'baden', 'archived': 'all', 'limit': '5'})
        for bad in ('0', '101'):
            with self.assertRaises(Failure) as caught:
                self.call_argv(['ticket', 'search', 'x', '--limit', bad], self.found)
            self.assertEqual(caught.exception.code, 2)

    def test_an_empty_search_is_a_usage_error_and_sends_nothing(self):
        with self.assertRaises(Failure) as caught:
            self.call_argv(['ticket', 'search', ' '], self.found)
        self.assertEqual(caught.exception.code, 2)
        self.assertEqual(self.requests, [])

    def test_list_shows_only_the_board_unless_asked_for_the_archive(self):
        for flags, expected in (([], None), (['--archived'], 'only'), (['--all'], 'all')):
            self.requests.clear()
            self.call_argv(['ticket', 'list'] + flags, env([]))
            self.assertEqual(self.requests[0].url.params.get('archived'), expected, flags)

    def test_list_archived_and_all_are_mutually_exclusive(self):
        with self.assertRaises(Failure):
            parser().parse_args(['ticket', 'list', '--archived', '--all'])

    def test_archive_and_unarchive_use_post_and_delete_with_dry_run(self):
        result, _ = self.call_argv(['ticket', 'archive', 'sd-12', '--dry-run'], env({'id': 'SD-12'}))
        request = self.requests[0]
        self.assertEqual((request.method, request.url.path, request.url.params['dry_run']), ('POST', '/api/tickets/SD-12/archive', '1'))
        self.assertEqual(result['meta']['action'], 'archive')
        self.requests.clear()
        self.call_argv(['ticket', 'unarchive', 'SD-12'], env({'id': 'SD-12'}))
        self.assertEqual((self.requests[0].method, self.requests[0].url.path), ('DELETE', '/api/tickets/SD-12/archive'))
        self.assertNotIn('dry_run', self.requests[0].url.params)

    def test_archive_needs_a_valid_reference(self):
        with self.assertRaises(Failure) as caught:
            self.call_argv(['ticket', 'archive', '../x'], env({}))
        self.assertEqual(caught.exception.code, 2)


class SearchRenderTests(unittest.TestCase):
    def render(self, result):
        import contextlib, io
        from sled_dog.cli import render
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            render(result, 'never')
        return buffer.getvalue()

    def search(self, rows, **meta):
        return self.render({'schema_version': 1, 'data': rows, 'errors': [], 'meta': dict({'kind': 'search', 'q': 'login'}, **meta)})

    def test_results_say_why_they_matched_and_mark_archived_tickets(self):
        out = self.search([
            {'id': 'SD-1', 'status': 'in_progress', 'title': 'Fix login', 'archivedAt': None, 'matchedIn': ['title', 'description'], 'snippet': '…cookies block the login…'},
            {'id': 'SD-2', 'status': 'done', 'title': 'Email', 'archivedAt': '2026-11-01T00:00:00Z', 'matchedIn': ['subtask SD-2.1'], 'snippet': None}])
        for expected in ('SD-1', 'in progress', 'Fix login', 'matched: title, description', '"…cookies block the login…"', 'SD-2', 'done · archived', 'matched: subtask SD-2.1'):
            self.assertIn(expected, out)

    def test_no_results_explains_what_search_looks_at(self):
        out = self.search([], q='zebra')
        self.assertIn('No tickets match "zebra".', out)
        self.assertIn('subtasks, trail steps and pull request titles', ' '.join(out.split()))  # rich wraps long lines

    def test_a_cut_off_result_list_says_so(self):
        out = self.search([{'id': 'SD-1', 'status': 'todo', 'title': 't', 'matchedIn': ['title']}], truncated=True)
        self.assertIn('More results available', out)

    def test_titles_and_snippets_are_untrusted_text(self):
        out = self.search([{'id': 'SD-1', 'status': 'todo', 'title': '\x1b[31mred\x1b[0m', 'matchedIn': ['title'], 'snippet': '\x1b]0;hijack\x07text'}])
        self.assertNotIn('\x1b', out)
        self.assertNotIn('\x07', out)

    def test_the_ticket_table_marks_an_archived_ticket(self):
        ticket = {'id': 'SD-5', 'status': 'done', 'priority': 'none', 'assignee': None, 'title': 'Old work', 'archivedAt': '2026-11-01T00:00:00Z', 'pullRequests': []}
        out = self.render({'schema_version': 1, 'data': ticket, 'meta': {'kind': 'tickets'}, 'errors': []})
        self.assertIn('done · archived', out)

    def test_archive_messages_distinguish_doing_from_previewing(self):
        ticket = {'id': 'SD-5', 'status': 'done', 'priority': 'none', 'assignee': None, 'title': 't', 'pullRequests': []}
        def show(action, dry):
            return self.render({'schema_version': 1, 'data': ticket, 'errors': [], 'meta': {'kind': 'tickets', 'action': action, 'dry_run': dry}})
        self.assertIn('Archived SD-5. It leaves the board but stays searchable.', show('archive', False))
        self.assertIn('Would archive SD-5.', show('archive', True))
        self.assertIn('Dry run: nothing was written.', show('archive', True))
        self.assertIn('Brought SD-5 back to the board.', show('unarchive', False))
        self.assertIn('Would bring SD-5 back', show('unarchive', True))
