#!/usr/bin/env bash
# Bounded runtime reuse; no package-manager or user-profile mutations.
set -u
SCRIPT_DIR=$(CDPATH= cd -- "${BASH_SOURCE[0]%/*}" && pwd)
PROJECT=$PWD
CACHE=${SPECGATE_TOOLCHAINS:-}
CHECK=0; PLAN=0; BOOTSTRAP=0
EXPECTED_HASH=
FORWARD=()
for argument in "$@"; do
  case "$argument" in
    --check) CHECK=1; FORWARD+=("$argument");;
    --plan) PLAN=1; FORWARD+=("$argument");;
    --bootstrap) BOOTSTRAP=1;;
    --expected-plan-hash=*) EXPECTED_HASH=${argument#--expected-plan-hash=}; if [[ ! "$EXPECTED_HASH" =~ ^[a-f0-9]{64}$ ]]; then printf '%s\n' '{"ok":false,"code":"INVALID_ARGUMENT"}'; exit 2; fi; FORWARD+=("$argument");;
    --project=*) PROJECT=${argument#--project=}; FORWARD+=("$argument");;
    --toolchain-dir=*) CACHE=${argument#--toolchain-dir=}; FORWARD+=("$argument");;
    --help|-h) printf '%s\n' 'SpecGate: --check is read-only; --plan shows a plan; --bootstrap permits interactive exact-plan Node runtime confirmation. SPECGATE_NODE reuses an existing runtime. Other options go to install-env.mjs.'; exit 0;;
    --only=*)
      IFS=',' read -r -a SELECTED <<< "${argument#--only=}"
      for selected in "${SELECTED[@]}"; do case "$selected" in git|node|python|go|jdk8|jdk17|jdk21|maven|gradle|pnpm|yarn|uv|poetry) ;; *) printf '%s\n' '{"ok":false,"code":"INVALID_ARGUMENT"}'; exit 2;; esac; done
      FORWARD+=("$argument");;
    --json|--no-env-write|--method=auto|--method=portable|--source=official|--source=domestic|--stack=node|--stack=react|--stack=vue|--stack=python|--stack=go|--stack=java|--node-version=*|--python-version=*|--go-version=*|--java-version=*|--build-tool=*|--frontend=*|--package-manager=*|--preset=*) FORWARD+=("$argument");;
    *) printf '%s\n' '{"ok":false,"code":"INVALID_ARGUMENT","message":"Unsupported installer argument"}'; exit 2;;
  esac
done
CACHE=${CACHE:-$PROJECT/.specgate/toolchains}
if [[ "$PROJECT$CACHE" =~ [[:cntrl:]] ]]; then printf '%s\n' '{"ok":false,"code":"INVALID_ARGUMENT","message":"Directory paths cannot contain control characters"}'; exit 2; fi
case "$PROJECT|$CACHE" in /*'|'/*) ;; *) printf '%s\n' '{"ok":false,"code":"INVALID_ARGUMENT","message":"Project and cache paths must be absolute"}'; exit 2;; esac
node_usable() {
  [ -n "${1:-}" ] && [ -x "$1" ] || return 1
  case "$1" in */.volta/bin/node|*/Volta/bin/node|*/volta/bin/node) return 1;; esac
  if [[ -n "${VOLTA_HOME:-}" && "${1%/*}" == "$VOLTA_HOME/bin" ]]; then return 1; fi
  command -v timeout >/dev/null 2>&1 || return 1
  timeout --kill-after=1 5 "$1" -e 'const v=process.versions.node.split(".").map(Number);process.exit(v[0]>20||(v[0]===20&&v[1]>=19)?0:1)' >/dev/null 2>&1
}
launch() { PATH="${1%/*}:$PATH" exec "$1" "$SCRIPT_DIR/install-env.mjs" "${FORWARD[@]}"; }
CANDIDATE=${SPECGATE_NODE:-}
if node_usable "$CANDIDATE"; then launch "$CANDIDATE"; fi
CANDIDATE=$(command -v node 2>/dev/null || true)
if node_usable "$CANDIDATE"; then launch "$CANDIDATE"; fi
COUNT=0
for CANDIDATE in "${VOLTA_HOME:-${HOME:-/nonexistent}/.volta}"/tools/image/node/*/bin/node "$CACHE"/node-*/bin/node "${HOME:-/nonexistent}"/.specgate/toolchains/node-*/bin/node "${NVM_DIR:-${HOME:-/nonexistent}/.nvm}"/versions/node/*/bin/node "${FNM_DIR:-/nonexistent}"/node-versions/*/installation/bin/node "${HOME:-/nonexistent}"/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node; do
  COUNT=$((COUNT+1)); [ "$COUNT" -le 40 ] || break
  if node_usable "$CANDIDATE"; then launch "$CANDIDATE"; fi
done
if [[ "${OSTYPE:-}" != linux* || "${HOSTTYPE:-}" != x86_64 ]]; then printf '%s\n' '{"ok":false,"code":"ENV_PLATFORM_UNSUPPORTED","message":"Native Node bootstrap supports Linux x64 only"}'; exit 2; fi
VERSION=; NAME=; URL=; CHECKSUM=; MATCHES=0
CATALOG_CONTENT=
IFS= read -r -N 4097 CATALOG_CONTENT < "$SCRIPT_DIR/../src/codex/core/node-bootstrap.tsv" || true
if [ "${#CATALOG_CONTENT}" -gt 4096 ]; then printf '%s\n' '{"ok":false,"code":"ENV_ARCHIVE_INVALID","message":"Oversized Node catalog"}'; exit 2; fi
while IFS='|' read -r platform arch version name url algorithm checksum metadata; do
  if [[ "$platform" == linux && "$arch" == x64 ]]; then VERSION=$version; NAME=$name; URL=$url; CHECKSUM=$checksum; ALGORITHM=$algorithm; MATCHES=$((MATCHES+1)); fi
done <<< "$CATALOG_CONTENT"
if [[ "$MATCHES" != 1 || ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || "$NAME" != "node-v$VERSION-linux-x64.tar.gz" || "$URL" != "https://nodejs.org/dist/v$VERSION/$NAME" || "$ALGORITHM" != sha256 || ! "$CHECKSUM" =~ ^[a-f0-9]{64}$ ]]; then printf '%s\n' '{"ok":false,"code":"ENV_ARCHIVE_INVALID"}'; exit 2; fi
# Native hashing is needed even to display an exact plan; absence is reported without installing it.
for tool in sha256sum realpath; do command -v "$tool" >/dev/null 2>&1 || { printf '%s\n' '{"ok":false,"code":"ENV_HOST_INSTALL_REQUIRED","message":"Plan requires existing sha256sum and realpath"}'; exit 2; }; done
CACHE=$(realpath -m -- "$CACHE")
TARGET=$CACHE/node-$VERSION
HASH=$(printf '%s' "linux|x64|$VERSION|$URL|$CHECKSUM|$TARGET" | sha256sum); HASH=${HASH%% *}
json_string() { local value=$1; value=${value//\\/\\\\}; value=${value//\"/\\\"}; printf '"%s"' "$value"; }
printf '{"ok":false,"environmentReady":false,"kind":"node-runtime-bootstrap","code":"NODE_RUNTIME_REQUIRED","platform":"linux","arch":"x64","version":"%s","url":"%s","algorithm":"sha256","checksum":"%s","location":' "$VERSION" "$URL" "$CHECKSUM"
json_string "$TARGET"
printf ',"planHash":"%s","workflowVerification":"not-run"}\n' "$HASH"
if [[ -n "$EXPECTED_HASH" && "$EXPECTED_HASH" != "$HASH" ]]; then printf '%s\n' 'ENV_INSTALL_PLAN_CHANGED: reviewed runtime hash differs; nothing installed' >&2; exit 2; fi
[ "$CHECK" -eq 0 ] || exit 2
[ "$PLAN" -eq 0 ] || exit 0
if [[ "$BOOTSTRAP" != 1 || ! -t 0 || ! -t 2 ]]; then printf '%s\n' 'ENV_INSTALL_CONSENT_REQUIRED: use --bootstrap in an interactive terminal or reuse SPECGATE_NODE' >&2; exit 3; fi
printf 'Type INSTALL %s to approve, or press Enter to decline: ' "$HASH" >&2
IFS= read -r REPLY
if [[ "$REPLY" != "INSTALL $HASH" ]]; then printf '%s\n' 'ENV_INSTALL_CONSENT_REQUIRED: installation declined; nothing installed' >&2; exit 3; fi
NEXT=(); for argument in "${FORWARD[@]}"; do case "$argument" in --expected-plan-hash=*) ;; *) NEXT+=("$argument");; esac; done; FORWARD=("${NEXT[@]}")
for tool in curl tar gzip mktemp mv rm mkdir; do command -v "$tool" >/dev/null 2>&1 || { printf 'ENV_HOST_INSTALL_REQUIRED: missing %s; nothing installed\n' "$tool" >&2; exit 2; }; done
ANCESTOR=$CACHE
while [[ "$ANCESTOR" != / ]]; do
  if [[ -L "$ANCESTOR" || -e "$ANCESTOR" && ! -d "$ANCESTOR" ]]; then printf '%s\n' 'ENV_TARGET_CONFLICT: parent is a link or file; preserved' >&2; exit 2; fi
  ANCESTOR=${ANCESTOR%/*}; ANCESTOR=${ANCESTOR:-/}
done
if [[ -e "$TARGET" || -L "$TARGET" ]]; then printf '%s\n' 'ENV_TARGET_CONFLICT: existing unusable target preserved' >&2; exit 2; fi
mkdir -p -- "$CACHE"
STAGE=$(mktemp -d "$CACHE/sg-bootstrap-XXXXXXXX") || exit 1
cleanup() { case "$STAGE" in "$CACHE"/sg-bootstrap-*) rm -rf -- "$STAGE";; esac; }
trap cleanup EXIT
if ! curl --proto '=https' --proto-redir '=https' --fail --location --connect-timeout 15 --max-time 120 --max-filesize 134217728 --output "$STAGE/$NAME" "$URL"; then printf '%s\n' 'ENV_DOWNLOAD_FAILED' >&2; exit 1; fi
ACTUAL=$(sha256sum "$STAGE/$NAME"); ACTUAL=${ACTUAL%% *}
if [[ "$ACTUAL" != "$CHECKSUM" ]]; then printf '%s\n' 'ENV_CHECKSUM_FAILED' >&2; exit 1; fi
PACKAGE=node-v$VERSION-linux-x64
LISTING=$(tar -tf "$STAGE/$NAME") || exit 1
while IFS= read -r entry; do
  case "$entry" in "$PACKAGE"|"$PACKAGE"/*) ;; *) printf '%s\n' 'ENV_ARCHIVE_INVALID' >&2; exit 1;; esac
  case "$entry" in /*|../*|*/../*|*/..|[A-Za-z]:*) printf '%s\n' 'ENV_ARCHIVE_INVALID' >&2; exit 1;; esac
done <<< "$LISTING"
mkdir "$STAGE/extracted"
tar -xf "$STAGE/$NAME" -C "$STAGE/extracted" || exit 1
NODE=$STAGE/extracted/$PACKAGE/bin/node
if ! node_usable "$NODE" || [[ "$("$NODE" --version)" != "v$VERSION" ]]; then printf '%s\n' 'ENV_VERIFICATION_FAILED' >&2; exit 1; fi
# GNU no-clobber rename preserves an independently appearing target.
mv -T -n -- "$STAGE/extracted/$PACKAGE" "$TARGET" || exit 1
if [[ -e "$STAGE/extracted/$PACKAGE" ]]; then printf '%s\n' 'ENV_TARGET_CONFLICT: target appeared; preserved' >&2; exit 1; fi
printf 'id=node\nversion=%s\nurl=%s\nsha256=%s\nlocation=%s\nplanHash=%s\nconsent=interactive-confirmation-of-plan-hash\noutput=%s\n' "$VERSION" "$URL" "$ACTUAL" "$TARGET" "$HASH" "$("$TARGET/bin/node" --version)" > "$TARGET/bootstrap-receipt.txt"
cleanup
trap - EXIT
launch "$TARGET/bin/node"
