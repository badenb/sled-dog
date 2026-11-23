import contextlib
import io
import json
import os
import unittest
from unittest.mock import patch

from sled_dog.cli import main

SECRET = 'ghp_secret-token-in-an-exception-message'


def run_main(argv, boom, debug=None):
    """Run main() with the command layer raising `boom`; return (exit code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    env = {'SLED_DOG_DEBUG': debug} if debug is not None else {}
    with patch.dict(os.environ, env, clear=False), patch('sled_dog.cli.run', side_effect=boom), \
         contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        if debug is None:
            os.environ.pop('SLED_DOG_DEBUG', None)
        code = main(argv)
    return code, out.getvalue(), err.getvalue()


class UnexpectedErrorTests(unittest.TestCase):
    def test_a_bug_in_sled_dog_says_so_and_names_the_error(self):
        code, out, err = run_main(['ticket', 'list', '--color', 'never'], AttributeError(SECRET))
        self.assertEqual(code, 1)
        self.assertIn('Internal error (AttributeError)', out)
        self.assertIn('a bug in sled-dog, not your setup', out)
        self.assertIn('SLED_DOG_DEBUG=1', out)

    def test_an_environment_problem_keeps_the_friendly_message_and_names_the_error(self):
        _, out, _ = run_main(['ticket', 'list', '--color', 'never'], OSError(SECRET))
        self.assertIn('Cannot complete request. Check configuration and host response.', out)
        self.assertIn('SLED_DOG_DEBUG=1', out)
        self.assertNotIn('Internal error', out)

    def test_the_exception_text_is_never_shown_by_default(self):
        for boom in (AttributeError(SECRET), OSError(SECRET), KeyError(SECRET), ValueError(SECRET)):
            code, out, err = run_main(['ticket', 'list', '--color', 'never'], boom)
            self.assertNotIn(SECRET, out + err, type(boom).__name__)
            self.assertEqual(err, '')

    def test_json_is_one_document_with_a_machine_readable_type(self):
        code, out, err = run_main(['ticket', 'list', '--json'], KeyError(SECRET))
        doc = json.loads(out)  # a single document: this raises if there is anything else on stdout
        self.assertEqual(code, 1)
        self.assertEqual(doc['errors'][0]['type'], 'KeyError')
        self.assertEqual(doc['errors'][0]['code'], 1)
        self.assertIn('Internal error (KeyError)', doc['errors'][0]['message'])
        self.assertIsNone(doc['data'])
        self.assertNotIn(SECRET, out)

    def test_debug_prints_the_traceback_on_stderr_and_keeps_json_clean(self):
        code, out, err = run_main(['ticket', 'list', '--json'], AttributeError(SECRET), debug='1')
        self.assertIn('Traceback', err)
        self.assertIn(SECRET, err)  # opted in, so the detail is allowed, but only here
        doc = json.loads(out)
        self.assertEqual(doc['errors'][0]['type'], 'AttributeError')
        self.assertNotIn('Traceback', out)
        self.assertNotIn(SECRET, out)
        self.assertNotIn('Re-run with SLED_DOG_DEBUG=1', doc['errors'][0]['message'])  # already on

    def test_debug_accepts_true_and_yes_and_ignores_other_values(self):
        for value, expect_trace in (('true', True), ('YES', True), ('0', False), ('', False)):
            _, _, err = run_main(['ticket', 'list', '--json'], TypeError('x'), debug=value)
            self.assertEqual('Traceback' in err, expect_trace, value)

    def test_expected_failures_and_interrupts_are_untouched(self):
        from sled_dog.config import Failure
        code, out, _ = run_main(['ticket', 'list', '--json'], Failure('Server rejected the token.', 3))
        self.assertEqual((code, json.loads(out)['errors'][0]['message']), (3, 'Server rejected the token.'))
        self.assertNotIn('type', json.loads(out)['errors'][0])
        code, out, _ = run_main(['ticket', 'list', '--json'], KeyboardInterrupt())
        self.assertEqual((code, json.loads(out)['errors'][0]['code']), (130, 130))


if __name__ == '__main__':
    unittest.main()
