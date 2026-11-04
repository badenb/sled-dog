"""Build a native executable and archive on the target OS (Python is build-time only)."""
import argparse
import hashlib
import importlib.metadata
from pathlib import Path
import platform
import os
import subprocess
import sys
import sysconfig
import tarfile
import zipfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', required=True, choices=['macos-arm64','macos-x86_64','linux-arm64','linux-x86_64','windows-x86_64'])
    args = parser.parse_args()
    system = {'Darwin':'macos','Linux':'linux','Windows':'windows'}[platform.system()]
    machine = {'AMD64':'x86_64','aarch64':'arm64'}.get(platform.machine(), platform.machine())
    if args.target != f'{system}-{machine}':
        parser.error('Build must run on the requested native OS and architecture.')
    # Explicit imports prevent frozen discovery from requiring third-party backend plugins.
    backend = {'macos':'keyring.backends.macOS', 'windows':'keyring.backends.Windows', 'linux':'keyring.backends.SecretService'}[system]
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--clean', '--noconfirm', '--onefile' if system == 'windows' else '--onedir',
        '--distpath','dist/standalone', '--name','sled-dog','--paths','.', '--collect-all','tzdata', '--copy-metadata','keyring', '--collect-submodules',backend,
        '--hidden-import',backend, 'packaging/entry.py'], check=True, env=dict(os.environ, PYINSTALLER_CONFIG_DIR=str(Path('build/pyinstaller-cache').resolve())))
    bundle = Path('dist/standalone/sled-dog')
    binary = Path('dist/standalone/sled-dog.exe') if system == 'windows' else bundle / 'sled-dog'
    subprocess.run([str(binary.resolve()), '--version'], check=True)
    subprocess.run([str(binary.resolve()), '--help'], check=True)
    # Exercise HTTP/TLS imports, Rich, config, and the selected native backend without secrets/network.
    subprocess.run([str(binary.resolve()), 'doctor', '--json'], check=True)
    out = Path('release')
    out.mkdir(exist_ok=True)
    name = f'sled-dog-{args.target}'
    licenses = Path('build/THIRD-PARTY-NOTICES.txt')
    notices = ['Sled Dog bundles Python and third-party libraries.\n']
    for dist in sorted(importlib.metadata.distributions(), key=lambda d:d.metadata['Name'].lower()):
        notices.append(f"\n{dist.metadata['Name']} {dist.version}\n")
        for file in dist.files or []:
            if 'license' in str(file).lower() or 'copying' in str(file).lower():
                path = dist.locate_file(file)
                if path.is_file():
                    notices.append(path.read_text(encoding='utf-8', errors='replace'))
    python_license = next((path for path in (Path(sys.base_prefix, 'LICENSE.txt'), Path(sysconfig.get_path('stdlib'), 'LICENSE.txt')) if path.is_file()), None)
    if python_license is None:
        raise SystemExit('Cannot find the bundled Python license; release archive was not created.')
    notices.append('\nPython license\n' + python_license.read_text(encoding='utf-8'))
    licenses.write_text('\n'.join(notices), encoding='utf-8')
    if system == 'windows':
        archive = out / (name + '.zip')
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as stream:
            stream.write(binary, binary.name)
            stream.write(licenses, licenses.name)
    else:
        archive = out / (name + '.tar.gz')
        with tarfile.open(archive, 'w:gz') as stream:
            stream.add(binary, arcname=binary.name)
            stream.add(bundle / '_internal', arcname='_internal')
            stream.add(licenses, arcname=licenses.name)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (out / (archive.name + '.sha256')).write_text(f'{digest}  {archive.name}\n')
    print(archive)


if __name__ == '__main__':
    main()
