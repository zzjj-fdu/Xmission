#!/bin/sh
set -eu
runtime=$1
mkdir -p "$runtime"
runtime=$(cd "$runtime" && pwd -P)
case "$(uname -m)" in arm64|aarch64) architecture=arm64;; x86_64) architecture=x64;; *) echo 'Unsupported Mac architecture' >&2; exit 1;; esac
version=v24.16.0
name="node-$version-darwin-$architecture"
node_dir="$runtime/$name"
node="$node_dir/bin/node"
npm_cli="$node_dir/lib/node_modules/npm/bin/npm-cli.js"
if [ ! -f "$node_dir/.xmission-complete" ] || [ ! -x "$node" ] || [ ! -f "$npm_cli" ]; then
  archive="$runtime/$name.tar.gz"
  sums="$runtime/node-shasums.txt"
  /usr/bin/curl --fail --location --silent --show-error --connect-timeout 20 --max-time 260 "https://nodejs.org/dist/$version/SHASUMS256.txt" -o "$sums"
  expected=$(/usr/bin/awk -v name="$name.tar.gz" '$2 == name {print $1}' "$sums")
  [ -n "$expected" ] || exit 1
  /usr/bin/curl --fail --location --silent --show-error --connect-timeout 20 --max-time 260 "https://nodejs.org/dist/$version/$name.tar.gz" -o "$archive"
  actual=$(/usr/bin/shasum -a 256 "$archive" | /usr/bin/awk '{print $1}')
  [ "$actual" = "$expected" ] || exit 1
  staging="$runtime/unpack-$version-$architecture"
  # All paths are fixed children of the application-owned runtime directory.
  rm -rf "$staging"
  mkdir -p "$staging"
  /usr/bin/tar -xzf "$archive" -C "$staging"
  staged_node="$staging/$name"
  [ "$("$staged_node/bin/node" --version)" = "$version" ]
  "$staged_node/bin/node" "$staged_node/lib/node_modules/npm/bin/npm-cli.js" --version >/dev/null
  printf '%s\n' "$version" > "$staged_node/.xmission-complete"
  rm -rf "$node_dir"
  mv "$staged_node" "$node_dir"
fi
printf '%s\n' "$node"
