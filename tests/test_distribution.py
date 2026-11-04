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
                binary.write_text('#!/bin/sh\necho "Sled Dog 0.2.0"\n')
                binary.chmod(0o755)
                archive = fixtures/'fixture.tar.gz'
                with tarfile.open(archive,'w:gz') as stream:
                    stream.add(binary,arcname='sled-dog')
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
