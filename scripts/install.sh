#!/bin/sh
# Install a published standalone binary without Python, pip, Homebrew, or sudo.
set -eu
case "$(uname -s)" in
  Darwin) system=macos ;;
  Linux) system=linux ;;
  *) echo 'Unsupported OS. Use the Windows installer or release downloads.' >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=x86_64 ;;
  *) echo 'Unsupported architecture.' >&2; exit 1 ;;
esac
command -v curl >/dev/null 2>&1 || { echo 'curl is required, or download the release archive using your browser.' >&2; exit 1; }
asset="sled-dog-$system-$arch.tar.gz"
base='https://github.com/badenb/sled-dog/releases/latest/download'
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' "$base/$asset" -o "$work/$asset"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' "$base/$asset.sha256" -o "$work/$asset.sha256"
expected=$(awk 'NR==1 {print $1}' "$work/$asset.sha256")
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$work/$asset" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$work/$asset" | awk '{print $1}')
else
  echo 'A SHA-256 tool (sha256sum or shasum) is required to verify the download.' >&2; exit 1
fi
[ "${#expected}" -eq 64 ] && [ "$expected" = "$actual" ] || { echo 'Checksum mismatch. Nothing installed.' >&2; exit 1; }
tar -xzf "$work/$asset" -C "$work" sled-dog
"$work/sled-dog" --version
install_dir=${SLED_DOG_INSTALL_DIR:-"$HOME/.local/bin"}
mkdir -p "$install_dir"
# Stage and rename on the destination filesystem so an existing install stays intact on failure.
staged=$(mktemp "$install_dir/.sled-dog.XXXXXX")
cp "$work/sled-dog" "$staged"
chmod 755 "$staged"
mv -f "$staged" "$install_dir/sled-dog"
printf '\nInstalled to %s/sled-dog\n' "$install_dir"
case ":$PATH:" in
  *":$install_dir:"*) echo 'Next: sled-dog auth login --host github.com' ;;
  *)
    # Add a quoted, idempotent PATH entry to the user shell startup file.
    case "${SHELL:-}" in
      */zsh) profile="$HOME/.zshrc" ;;
      */bash) profile="$HOME/.bashrc"; [ "$system" != macos ] || profile="$HOME/.bash_profile" ;;
      *) profile='' ;;
    esac
    if [ -n "$profile" ]; then
      # Single-quote escaping also supports spaces/apostrophes in the install path.
      quoted=$(printf '%s' "$install_dir" | sed "s/'/'\\\\''/g")
      line="export PATH='$quoted':\$PATH"
      touch "$profile"
      grep -Fqx "$line" "$profile" || printf '\n%s\n' "$line" >> "$profile"
      echo 'PATH configured. Open a new terminal, then run: sled-dog auth login --host github.com'
    else
      printf 'Add %s to PATH, or run %s/sled-dog directly.\n' "$install_dir" "$install_dir"
    fi ;;
esac
