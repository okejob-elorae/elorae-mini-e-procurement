#!/usr/bin/env bash
#
# Run a pnpm verification command (type-check, a scoped vitest run, lint)
# inside a resource-capped container, so it cannot starve the machine.
#
#   scripts/verify.sh -F @elorae/web type-check
#   scripts/verify.sh -F @elorae/web exec vitest run lib/items/variant-rows
#   scripts/verify.sh -F @elorae/db exec vitest run --no-file-parallelism stock
#
# Everything after the script name is passed to `pnpm` verbatim, so the
# scoping rules in AGENTS.md § What NOT to do apply unchanged.
#
# Why a container: on a WSL box with ~7.6 GB of RAM, `@elorae/web` type-check
# beside an editor's own TypeScript server pushed the VM into swap and pinned
# the host disk at 100% for minutes. The container gets a hard memory ceiling
# with NO swap (a run that outgrows it is killed with exit 137 instead of
# thrashing), a CPU cap, and read/write bandwidth caps on the disk that holds
# the repo. Tune with VERIFY_MEMORY, VERIFY_HEAP_MB, VERIFY_CPUS,
# VERIFY_READ_BPS and VERIFY_WRITE_BPS.
#
# VERIFY_HEAP_MB is set explicitly because node sizes its default heap from the
# cgroup limit at roughly half of it, and a cold (non-incremental) web
# type-check needs more than that: at a 3 GB limit tsc died at a 1.5 GB heap.
# Keep the heap about 1 GB under VERIFY_MEMORY for native and buffer memory.
#
# The repo is mounted at its own absolute path and the container runs as your
# uid, so caches (tsbuildinfo, vitest) and any file a run writes stay valid and
# owned by you on the host. Host networking lets specs reach the local test
# bed on 127.0.0.1:3308. Host environment variables are NOT passed in: specs
# read apps/web/.env like they do on the host, and the script refuses to run
# when that file points DATABASE_URL at the 3307 prod tunnel.
#
# Dependencies are not installed here. Run `pnpm install` on the host first;
# the container reuses the host's node_modules.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/verify.sh <pnpm args...>" >&2
  exit 2
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${VERIFY_IMAGE:-node:22.18.0-bookworm-slim}"
PNPM_VERSION="$(sed -nE 's/.*"packageManager": *"pnpm@([^"]+)".*/\1/p' "$REPO/package.json")"
CACHE_DIR="${VERIFY_CACHE_DIR:-$HOME/.cache/elorae-verify}"

if [ -z "$PNPM_VERSION" ]; then
  echo "verify: could not read the pnpm version from package.json packageManager" >&2
  exit 2
fi

if grep -Eq '^DATABASE_URL=.*:3307/' "$REPO/apps/web/.env" 2>/dev/null; then
  echo "verify: apps/web/.env points DATABASE_URL at :3307 (the prod tunnel). Refusing." >&2
  exit 2
fi

mkdir -p "$CACHE_DIR"

io_args=()
device="$(df --output=source "$REPO" | tail -n 1)"
if [ -b "$device" ]; then
  io_args+=(--device-read-bps "$device:${VERIFY_READ_BPS:-150mb}")
  io_args+=(--device-write-bps "$device:${VERIFY_WRITE_BPS:-80mb}")
else
  echo "verify: $device is not a block device; running without disk bandwidth caps" >&2
fi

tty_args=()
if [ -t 1 ]; then
  tty_args+=(-t)
fi

exec docker run --rm --init "${tty_args[@]}" \
  --user "$(id -u):$(id -g)" \
  --network host \
  --memory "${VERIFY_MEMORY:-4g}" --memory-swap "${VERIFY_MEMORY:-4g}" \
  --cpus "${VERIFY_CPUS:-4}" \
  "${io_args[@]}" \
  -e HOME=/cache/home \
  -e COREPACK_HOME=/cache/corepack \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e XDG_CACHE_HOME=/cache/xdg \
  -e CI=true \
  -e NODE_OPTIONS="--max-old-space-size=${VERIFY_HEAP_MB:-3072}" \
  -v "$CACHE_DIR:/cache" \
  -v "$REPO:$REPO" \
  -w "$REPO" \
  "$IMAGE" \
  sh -c 'mkdir -p "$HOME" && exec corepack "pnpm@$0" "$@"' "$PNPM_VERSION" "$@"
