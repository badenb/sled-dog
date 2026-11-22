import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from sled_dog.cli import parser, run
from sled_dog.config import Config, Failure
from sled_dog.platform import Platform, server_url, ticket_ref


class Secrets:
    store = {}
    def get(self, host, account): return self.store.get((host, account))
    def put(self, host, account, token): self.store[host, account] = token


class PlatformTests(unittest.TestCase):
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
