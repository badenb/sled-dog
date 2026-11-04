import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx

from sled_dog.cli import main, parser, reference, run, safe
from sled_dog.config import Config, Failure, api_base, host_name
from sled_dog.github import GitHub


class FakeSecrets:
    store = {}
    def get(self, host, account):
        return self.store.get((host, account))
    def put(self, host, account, token):
        self.store[host, account] = token
    def delete(self, host, account):
        del self.store[host, account]


class FakeGitHub:
    def __init__(self, base, token):
        self.token = token
    def identity(self):
        return self.token
    def close(self):
        pass


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = Config(Path(self.temp.name) / 'config.json')
        FakeSecrets.store = {}

    def args(self, text):
        return parser().parse_args(text.split())

    def client(self, handler):
        github = GitHub('https://enterprise.test/api/v3', 'secret-test-token')
        github.client.close()
        github.client = httpx.Client(transport=httpx.MockTransport(handler), headers={'Authorization':'Bearer secret-test-token'}, follow_redirects=False)
        self.addCleanup(github.close)
        return github

    def test_host_and_url_validation(self):
        for value in ('https://evil.test', 'a/b', 'x@evil.test', '../x'):
            with self.assertRaises(Failure):
                host_name(value)
        for url in ('http://host', 'https://user:pass@host', 'https://host/?token=x', 'https://host/../api'):
            with self.assertRaises(Failure):
                api_base('host', url)
        self.assertEqual(api_base('github.com'), 'https://api.github.com')
        self.assertEqual(api_base('enterprise.test'), 'https://enterprise.test/api/v3')

    def test_reference_host_conflict(self):
        self.assertEqual(reference('a/b#42', None), (None,'a','b',42))
        with self.assertRaises(Failure):
            reference('https://evil.test/a/b/pull/42', 'github.com')
        with self.assertRaises(Failure):
            reference('https://user:password@host/a/b/pull/42', None)

    def test_literal_terminal_text(self):
        result = safe('\x1b[2Jhello\x1b]8;;https://evil\x07world\x1b]8;;\x07\x00')
        self.assertEqual(result, 'helloworld')
        self.assertEqual(safe('[bold]literal[/bold]'), '[bold]literal[/bold]')

    def test_config_atomic_permissions_and_corruption(self):
        self.config.save()
        self.assertEqual(self.config.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(Config(self.config.path).data['schema_version'], 1)
        self.config.path.write_text('{bad')
        with self.assertRaises(Failure):
            Config(self.config.path)

    def test_multiple_accounts_login_switch_logout(self):
        for user in ('alice','bob'):
            args = self.args('auth login --host enterprise.test --with-token')
            with patch('sys.stdin', io.StringIO(user)):
                result, code = run(args, self.config, FakeSecrets, FakeGitHub)
            self.assertEqual(code, 0)
            self.assertEqual(result['meta']['account'], user)
        self.assertEqual(self.config.data['hosts']['enterprise.test']['accounts'], ['alice','bob'])
        self.assertNotIn('token', self.config.path.read_text())
        run(self.args('auth switch --host enterprise.test --account alice'), self.config, FakeSecrets)
        self.assertEqual(self.config.data['hosts']['enterprise.test']['active'], 'alice')
        run(self.args('auth logout --host enterprise.test --account alice'), self.config, FakeSecrets)
        self.assertEqual(self.config.data['hosts']['enterprise.test']['active'], 'bob')
        self.assertNotIn(('enterprise.test','alice'), FakeSecrets.store)

    def test_ephemeral_identity_mismatch_and_host_required(self):
        with patch.dict(os.environ, {'SLED_DOG_TOKEN':'alice'}):
            with self.assertRaises(Failure):
                run(self.args('pr list --mine'), self.config, FakeSecrets, FakeGitHub)
            with self.assertRaises(Failure):
                run(self.args('pr list --mine --host github.com --account bob'), self.config, FakeSecrets, FakeGitHub)
        self.assertFalse(self.config.path.exists())

    def test_json_argument_error_is_one_document(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = main(['pr','list','--mine','--limit','invalid','--json'])
        self.assertEqual(code, 2)
        result = json.loads(output.getvalue())
        self.assertEqual(result['schema_version'], 1)
        self.assertTrue(result['errors'])
        self.assertNotIn('\x1b', output.getvalue())

    def test_redirect_is_not_followed_and_body_is_not_exposed(self):
        calls = []
        def handler(request):
            calls.append(str(request.url))
            return httpx.Response(302, headers={'location':'https://evil.test'}, text='secret-test-token')
        github = self.client(handler)
        with self.assertRaises(Failure) as raised:
            github.identity()
        self.assertEqual(len(calls), 1)
        self.assertNotIn('secret-test-token', str(raised.exception))

    def test_search_does_not_follow_provider_urls(self):
        calls = []
        def handler(request):
            calls.append(request.url.path)
            return httpx.Response(200, json={'total_count':1200,'incomplete_results':True,'items':[{'number':42,'title':'literal','html_url':'https://enterprise.test/a/b/pull/42','pull_request':{'url':'https://evil.test'}}]})
        rows, meta = self.client(handler).search('alice', self.args('pr list --mine --limit 1'))
        self.assertEqual(calls, ['/api/v3/search/issues'])
        self.assertFalse(meta['complete'])
        self.assertTrue(meta['truncated'])
        self.assertTrue(meta['provider_ceiling'])
        self.assertEqual(rows[0]['repository'], 'a/b')

    def test_team_reviews_union_and_deduplication(self):
        queries = []
        def handler(request):
            if request.url.path.endswith('/user/teams'):
                return httpx.Response(200,json=[{'organization':{'login':'acme'},'slug':'devs'}])
            queries.append(request.url.params['q'])
            return httpx.Response(200,json={'total_count':1,'items':[{'number':1,'html_url':'https://host/a/b/pull/1'}]})
        rows, meta = self.client(handler).search('alice', self.args('pr list --review-requested'))
        self.assertEqual(len(rows),1)
        self.assertTrue(any('team-review-requested:acme/devs' in q for q in queries))
        self.assertTrue(meta['complete'])

    def test_checks_latest_status_and_stale_head(self):
        count = 0
        sha = 'a'*40
        def handler(request):
            nonlocal count
            if '/pulls/' in request.url.path:
                count += 1
                return httpx.Response(200,json={'head':{'sha':sha if count == 1 else 'b'*40}})
            self.assertIn(sha,request.url.path)
            if request.url.path.endswith('/check-runs'):
                return httpx.Response(200,json={'check_runs':[{'id':1,'name':'tests','status':'completed','conclusion':'success','app':{'id':1},'check_suite':{'id':2}}]})
            return httpx.Response(200,json=[{'id':2,'context':'jenkins','state':'success'},{'id':1,'context':'jenkins','state':'failure'}])
        data, errors = self.client(handler).checks('a','b',42)
        self.assertTrue(data['stale'])
        self.assertEqual(len(data['checks']),2)
        self.assertTrue(all(x['state'] == 'success' for x in data['checks']))

    def test_checks_missing_source_is_unavailable(self):
        def handler(request):
            if '/pulls/' in request.url.path:
                return httpx.Response(200,json={'head':{'sha':'a'*40}})
            return httpx.Response(403,json={})
        data, errors = self.client(handler).checks('a','b',42)
        self.assertEqual(data['state'],'unavailable')
        self.assertEqual(len(errors),2)

    def test_empty_checks_is_not_success(self):
        def handler(request):
            if '/pulls/' in request.url.path:
                data = {'head':{'sha':'a'*40}}
            elif request.url.path.endswith('/check-runs'):
                data = {'check_runs':[]}
            else:
                data = []
            return httpx.Response(200,json=data)
        data, errors = self.client(handler).checks('a','b',42)
        self.assertEqual(data['state'],'none')
        self.assertEqual(errors,[])

    def test_pagination(self):
        pages = []
        def handler(request):
            page = int(request.url.params['page'])
            pages.append(page)
            return httpx.Response(200,json=list(range(100)) if page == 1 else [100])
        rows = self.client(handler).pages('/user/teams')
        self.assertEqual(len(rows),101)
        self.assertEqual(pages,[1,2])

class StorageTests(unittest.TestCase):
    def test_native_adapter_never_uses_subprocess_or_fallback(self):
        from sled_dog.config import Secrets
        from unittest.mock import Mock
        backend = Mock()
        with patch('sys.platform', 'darwin'), patch('keyring.backends.macOS.Keyring', return_value=backend), patch('subprocess.run') as subprocess:
            secrets = Secrets()
            secrets.put('github.com', 'Alice', 'sensitive-token')
            backend.set_password.assert_called_once_with('com.sled-dog.cli.v2', 'github.com/alice', 'sensitive-token')
            subprocess.assert_not_called()
            backend.set_password.side_effect = RuntimeError('sensitive-token')
            with self.assertRaises(Failure) as raised:
                secrets.put('github.com', 'Alice', 'sensitive-token')
            self.assertNotIn('sensitive-token', str(raised.exception))
        with patch('sys.platform', 'linux'):
            with self.assertRaises(Failure):
                Secrets()

    def test_migration_preserves_original(self):
        class LegacySecrets(FakeSecrets):
            def legacy(self):
                return 'alice'
        with tempfile.TemporaryDirectory() as directory:
            config = Config(Path(directory) / 'cli-v2.json')
            legacy = config.path.parent / 'config.json'
            original = json.dumps({'github_api_url':'https://api.github.com', 'github_org':'acme'})
            legacy.write_text(original)
            result, code = run(parser().parse_args(['auth','migrate','--host','github.com']), config, LegacySecrets, FakeGitHub)
            self.assertEqual(code,0)
            self.assertEqual(result['data']['account'],'alice')
            self.assertEqual(legacy.read_text(),original)
            self.assertNotIn('github_org',config.path.read_text())

    def test_render_is_plain_when_piped(self):
        from sled_dog.cli import envelope, render
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            render(envelope([{'number':1,'title':'[bold]literal\x1b[2J','state':'open','author':'alice','html_url':'https://host/a/b/pull/1','repository':'a/b'}], {'host':'github.com','account':'alice'}), 'never')
        value = output.getvalue()
        self.assertIn('[bold]literal',value)
        self.assertNotIn('\x1b',value)
        self.assertIn('#1',value)
        self.assertNotIn('a/b #1',value)


class InteractiveLoginTests(unittest.TestCase):
    def test_hidden_prompt_login(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Config(Path(directory) / 'config.json')
            FakeSecrets.store = {}
            args = parser().parse_args(['auth', 'login', '--host', 'github.com'])
            with patch('sys.stdin.isatty', return_value=True), patch('getpass.getpass', return_value='alice') as prompt:
                result, code = run(args, config, FakeSecrets, FakeGitHub)
            prompt.assert_called_once()
            self.assertEqual(code, 0)
            self.assertEqual(result['data']['account'], 'alice')

    def test_unavailable_hidden_prompt_fails_closed(self):
        import getpass
        import warnings
        def unavailable(*args):
            warnings.warn('Hidden input unavailable', getpass.GetPassWarning)
            self.fail('Must not read an echoed token')
        with tempfile.TemporaryDirectory() as directory:
            config = Config(Path(directory) / 'config.json')
            args = parser().parse_args(['auth', 'login', '--host', 'github.com'])
            with patch('sys.stdin.isatty', return_value=True), patch('getpass.getpass', side_effect=unavailable):
                with self.assertRaises(Failure) as raised:
                    run(args, config, FakeSecrets, FakeGitHub)
            self.assertEqual(raised.exception.code, 3)
            self.assertFalse(config.path.exists())


class CardTests(unittest.TestCase):
    def test_card_wraps_labels_and_uses_safe_provider_colors(self):
        from rich.console import Console
        from sled_dog.cli import pr_card
        row = {'repository':'acme/service', 'number':42, 'title':'[bold]Literal title with a long description that wraps',
               'state':'open', 'author':'alice', 'labels':['bug', 'needs review'],
               'label_colors':{'bug':'d73a4a','needs review':'invalid[markup]'},
               'html_url':'https://github.com/acme/service/pull/42'}
        output = io.StringIO()
        console = Console(file=output, width=48, height=25, force_terminal=True, color_system='truecolor', no_color=False, _environ={'TERM':'xterm-256color'})
        console.print(pr_card(row))
        value = output.getvalue()
        self.assertIn('48;2;215;58;74', value)
        self.assertIn('[bold]Literal',value)
        self.assertIn('needs review',value)
        self.assertNotIn('invalid[markup]',value)
        self.assertNotIn('\x1b[?1049',value)
        self.assertNotIn('\x1b[2J',value)
        plain = safe(value)
        self.assertTrue(all(len(line) <= 48 for line in plain.splitlines()))


class BuildTests(unittest.TestCase):
    def test_build_summary_preserves_partial_and_stale_results(self):
        github = GitHub.__new__(GitHub)
        def checks(owner, repo, number):
            if number == 3:
                raise Failure('No repository access.')
            return {'state':'stale' if number == 2 else 'success', 'stale':number == 2,
                    'head_sha':'a'*40, 'checks':[{'state':'success'}, {'state':'success'}]}, []
        github.checks = checks
        rows, errors = github.builds([{'repository':'acme/app','number':n} for n in (1,2,3)])
        self.assertEqual(rows[0]['build']['state'],'success')
        self.assertEqual(rows[0]['build']['counts'],{'success':2})
        self.assertEqual(rows[0]['build']['total'],2)
        self.assertEqual(rows[1]['build']['state'],'stale')
        self.assertEqual(rows[2]['build']['state'],'unavailable')
        self.assertEqual(len(errors),2)
        self.assertEqual([row['number'] for row in rows],[1,2,3])

    def test_list_can_skip_builds_and_partial_builds_set_exit_code(self):
        class Client(FakeGitHub):
            calls = 0
            def search(self, login, args):
                return [{'repository':'acme/app','number':1}], {'complete':True}
            def card_details(self, rows):
                return rows, []
            def builds(self, rows):
                Client.calls += 1
                return [dict(rows[0], build={'state':'unavailable'})], [{'message':'Build unavailable.'}]
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'SLED_DOG_TOKEN':'alice'}):
            config = Config(Path(directory)/'config.json')
            args = parser().parse_args(['pr','list','--mine','--host','github.com'])
            result, code = run(args, config, FakeSecrets, Client)
            self.assertEqual(code,4)
            self.assertFalse(result['meta']['complete'])
            self.assertEqual(result['data'][0]['build']['state'],'unavailable')
            args.no_checks = True
            result, code = run(args, config, FakeSecrets, Client)
            self.assertEqual(code,0)
            self.assertEqual(Client.calls,1)
            self.assertNotIn('build',result['data'][0])

    def test_build_badges_are_literal_and_colorful(self):
        from rich.console import Console
        from sled_dog.cli import pr_card
        output = io.StringIO()
        Console(file=output, width=72, height=25, force_terminal=True, no_color=False,
                _environ={'TERM':'xterm-256color'}).print(pr_card({
                    'repository':'acme/app','number':1,'title':'Example','state':'open',
                    'build':{'state':'failure','counts':{'success':2,'failure':1}}}))
        self.assertIn('FAILING', output.getvalue())
        self.assertIn('1 failure', output.getvalue())
        self.assertIn('2 success', output.getvalue())
        self.assertIn('41m',output.getvalue())


class ReviewDetailTests(unittest.TestCase):
    def test_review_decisions_counts_comments_and_changes(self):
        github = GitHub.__new__(GitHub)
        github.get = lambda path: {'number':42,'html_url':'https://github.com/acme/app/pull/42',
            'created_at':'2026-11-01T12:00:00Z','additions':123,'deletions':45,
            'comments':3,'review_comments':7,'head':{},'base':{},'labels':[{'name':'bug','color':'d73a4a'}]}
        def review(user, state, day, id):
            return {'id':id,'user':{'login':user},'state':state,'submitted_at':f'2026-11-0{day}T12:00:00Z'}
        github.pages = lambda path: [
            review('alice','APPROVED',1,1), review('alice','COMMENTED',2,2),
            review('bob','APPROVED',1,3), review('bob','CHANGES_REQUESTED',2,4),
            review('carol','DISMISSED',1,5), review('dave','PENDING',1,6),
            review('eve','COMMENTED',1,7), review('frank','APPROVED',1,8),
            review('frank','APPROVED',2,9)]
        data, warnings = github.detail('acme','app',42)
        self.assertEqual(warnings,[])
        self.assertEqual(data['approval_count'],2)
        self.assertEqual(data['comment_count'],10)
        self.assertEqual(data['discussion_comments'],3)
        self.assertEqual(data['inline_comments'],7)
        self.assertEqual((data['additions'],data['deletions']),(123,45))
        states = {r['reviewer']:r['state'] for r in data['reviews']}
        self.assertEqual(states['alice'],'APPROVED')
        self.assertEqual(states['bob'],'CHANGES_REQUESTED')
        self.assertNotIn('dave',states)
        self.assertEqual(data['labels'],['bug'])
        rows, errors = github.card_details([{'repository':'acme/app','number':42}])
        self.assertEqual(errors,[])
        self.assertEqual(rows[0]['approval_count'],2)
        self.assertNotIn('body',rows[0])

    def test_unavailable_reviews_are_unknown_not_zero(self):
        github = GitHub.__new__(GitHub)
        github.get = lambda path: {'number':42,'html_url':'https://github.com/acme/app/pull/42','head':{},'base':{}}
        def unavailable(path):
            raise Failure('Denied.')
        github.pages = unavailable
        rows, errors = github.card_details([{'repository':'acme/app','number':42}])
        self.assertIsNone(rows[0]['approval_count'])
        self.assertIsNone(rows[0]['reviews'])
        self.assertIsNone(rows[0]['comment_count'])
        self.assertTrue(errors)

    def test_age_uses_creation_time_and_handles_invalid_values(self):
        from datetime import datetime, timezone
        from sled_dog.cli import pr_age
        at = datetime(2026,11,4,12,tzinfo=timezone.utc)
        self.assertEqual(pr_age('2026-11-01T12:00:00Z',at),'3d')
        self.assertEqual(pr_age('2026-11-04T11:00:00Z',at),'1h')
        self.assertEqual(pr_age('2026-11-04T11:55:00Z',at),'5m')
        self.assertEqual(pr_age('2026-11-05T12:00:00Z',at),'<1m')
        for value in (None,'bad','2026-11-01'):
            self.assertEqual(pr_age(value,at),'unknown')

    def test_card_shows_changes_reviews_comments_age_and_labels(self):
        from rich.console import Console
        from sled_dog.cli import pr_card
        output = io.StringIO()
        Console(file=output,width=120,height=25,force_terminal=False).print(pr_card({
            'repository':'acme/app','number':42,'title':'Example','created_at':'2026-11-01T12:00:00Z',
            'additions':123,'deletions':45,'approval_count':1,'comment_count':10,
            'reviews':[{'reviewer':'alice','state':'APPROVED'}], 'labels':['bug']}))
        text = output.getvalue()
        for expected in ('+123','-45','1 approval','10 comments','alice (approved)','Age','bug'):
            self.assertIn(expected,text)


if __name__ == '__main__':
    unittest.main()
