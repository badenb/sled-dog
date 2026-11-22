import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

from sled_dog.cli import main
from sled_dog.config import Secrets

ROOT = Path(__file__).resolve().parents[1]


class DistributionTests(unittest.TestCase):
    def test_doctor_does_not_use_network_or_read_tokens(self):
        output = io.StringIO()
        with patch('httpx.Client') as http, patch('sled_dog.config.Secrets.get') as token, contextlib.redirect_stdout(output):
            self.assertEqual(main(['doctor','--json']),0)
        self.assertIn('credential_store',json.loads(output.getvalue())['data'])
        token.assert_not_called()
        http.assert_not_called()

    def test_explicit_windows_and_linux_backends(self):
        for system, module, name in [('win32','keyring.backends.Windows','WinVaultKeyring'), ('linux','keyring.backends.SecretService','Keyring')]:
            fake = types.ModuleType(module)
            factory = Mock()
            setattr(fake,name,factory)
            with patch.dict(sys.modules,{module:fake}), patch('sys.platform',system):
                secrets = Secrets()
                self.assertIs(secrets.backend,factory.return_value)

    @unittest.skipIf(os.name == 'nt','POSIX installer test')
    def test_installer_checksum_install_and_path_without_python(self):
        for valid in (True,False):
            with self.subTest(valid_checksum=valid), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                home = root / 'home with spaces'
                home.mkdir()
                fixtures = root/'fixtures'
                fixtures.mkdir()
                binary = root/'sled-dog'
                binary.write_text('#!/bin/sh\necho "Sled Dog 1.0.0"\n')
                binary.chmod(0o755)
                archive = fixtures/'fixture.tar.gz'
                with tarfile.open(archive,'w:gz') as stream:
                    stream.add(binary,arcname='sled-dog')
                    runtime = root/'runtime.txt'
                    runtime.write_text('bundled runtime fixture')
                    stream.add(runtime,arcname='_internal/runtime.txt')
                digest = hashlib.sha256(archive.read_bytes()).hexdigest() if valid else '0'*64
                (fixtures/'fixture.sha256').write_text(digest+'  fixture.tar.gz\n')
                tools = root/'tools'
                tools.mkdir()
                # curl only serves local fixtures: tests never contact GitHub or run a downloaded release.
                curl = tools/'curl'
                curl.write_text('''#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    https://*) url=$1 ;;
    -o) shift; dest=$1 ;;
  esac
  shift
done
case "$url" in
  *.sha256) cp "$FIXTURES/fixture.sha256" "$dest" ;;
  *) cp "$FIXTURES/fixture.tar.gz" "$dest" ;;
esac
''')
                curl.chmod(0o755)
                dest = home/"user's tools"
                env = dict(os.environ,HOME=str(home),SHELL='/bin/zsh',FIXTURES=str(fixtures),
                           SLED_DOG_INSTALL_DIR=str(dest),PATH=str(tools)+os.pathsep+os.defpath)
                result = subprocess.run(['/bin/sh',str(ROOT/'scripts/install.sh')],env=env,capture_output=True,text=True)
                if valid:
                    self.assertEqual(result.returncode,0,result.stderr)
                    self.assertTrue((dest/'sled-dog').is_file())
                    self.assertEqual(((dest/'sled-dog').resolve().parent/'_internal/runtime.txt').read_text(),'bundled runtime fixture')
                    profile = home/'.zshrc'
                    subprocess.run(['/bin/sh','-n',str(profile)],check=True)
                    resolved = subprocess.run(['/bin/sh','-c','. "$HOME/.zshrc"; command -v sled-dog'],env=env,capture_output=True,text=True,check=True)
                    self.assertEqual(resolved.stdout.strip(),str(dest/'sled-dog'))
                    subprocess.run(['/bin/sh',str(ROOT/'scripts/install.sh')],env=env,capture_output=True,check=True)
                    self.assertEqual(profile.read_text().count('export PATH='),1)
                else:
                    self.assertNotEqual(result.returncode,0)
                    self.assertIn('Checksum mismatch',result.stderr)
                    self.assertFalse((dest/'sled-dog').exists())


class StartupTests(unittest.TestCase):
    def test_local_status_does_not_import_http_or_credentials(self):
        code = """
import contextlib, io, sys, tempfile
from pathlib import Path
from unittest.mock import patch
from sled_dog.cli import main
from sled_dog.config import Config
with tempfile.TemporaryDirectory() as directory:
    with patch('sled_dog.cli.Config', return_value=Config(Path(directory)/'config.json')):
        with contextlib.redirect_stdout(io.StringIO()):
            assert main(['auth','status','--json']) == 0
assert 'httpx' not in sys.modules
assert 'keyring' not in sys.modules
assert 'sled_dog.github' not in sys.modules
"""
        subprocess.run([sys.executable,'-c',code],check=True,cwd=ROOT)


class TimezoneTests(unittest.TestCase):
    def test_eastern_respects_dst_and_rejects_naive_timestamps(self):
        from sled_dog.cli import eastern_time
        self.assertEqual(eastern_time('2026-01-15T20:30:00Z'),'Jan 15 15:30 EST')
        self.assertEqual(eastern_time('2026-07-15T20:30:00Z'),'Jul 15 16:30 EDT')
        self.assertEqual(eastern_time('2026-07-15T16:30:00-04:00'),'Jul 15 16:30 EDT')
        self.assertEqual(eastern_time(None),'unknown')
        self.assertEqual(eastern_time('2026-07-15T20:30:00'),'unknown')

    def test_compact_review_queue_wide_and_narrow(self):
        from rich.console import Console
        from sled_dog.cli import review_queue, safe
        rows=[{'repository':'acme/app','number':i,'title':'[bold] Literal title',
               'labels':['bug'], 'author':'alice', 'html_url':f'https://github.com/acme/app/pull/{i}', 'created_at':'2026-01-01T00:00:00Z','updated_at':'2026-07-15T20:30:00Z',
               'approval_count':1,'comment_count':2,'reviews':[{'reviewer':'alice','state':'APPROVED'}],
               'additions':10,'deletions':3,'build':{'state':'success'}} for i in range(1,16)]
        for width in (140,60):
            output=io.StringIO()
            console=Console(file=output,width=width,height=25,force_terminal=False)
            review_queue(rows,console)
            text=output.getvalue()
            for expected in ('#15','bug','alice','old)','https://github.com/acme/app/pull/15','1 approval','2 comments','[bold] Literal title'):
                self.assertIn(expected,text)
            self.assertTrue(all(len(line)<=width for line in text.splitlines()))
            if width==140:
                self.assertEqual(len(text.splitlines()),90)


class BundledTimezoneTests(unittest.TestCase):
    def test_timezone_without_system_database(self):
        code = """
from zoneinfo import reset_tzpath, ZoneInfo
reset_tzpath(())
ZoneInfo.clear_cache()
from sled_dog.cli import eastern_time
assert eastern_time('2026-07-15T20:30:00Z') == 'Jul 15 16:30 EDT'
"""
        subprocess.run([sys.executable,'-c',code],check=True,cwd=ROOT)
