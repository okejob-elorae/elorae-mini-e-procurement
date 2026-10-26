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
# the repo. Knobs (environment variables):
#
#   VERIFY_MEMORY     container memory ceiling, no swap      (default 4g)
#   VERIFY_HEAP_MB    node --max-old-space-size per process  (default 3072)
#   VERIFY_CPUS       CPU cap, clamped to the host's cores   (default 4)
#   VERIFY_READ_BPS   read bandwidth cap on the repo's disk  (default 150mb)
#   VERIFY_WRITE_BPS  write bandwidth cap on the repo's disk (default 80mb)
#   VERIFY_IMAGE      node image                             (default node:22.18.0-bookworm-slim)
#   VERIFY_CACHE_DIR  host dir for corepack and tool caches  (default ~/.cache/elorae-verify)
#
# The disk caps are best-effort: they apply only when the repo sits on a disk
# the script can resolve to a whole block device (cgroup v2 throttles whole
# disks). Otherwise it warns on stderr and runs without them; the memory and
# CPU caps always apply. CI=true is set inside, as on CI, so pnpm and vitest
# run non-interactively.
#
# VERIFY_HEAP_MB is set explicitly because node sizes its default heap from the
# cgroup limit at roughly half of it, and a cold (non-incremental) web
# type-check needs more than that: at a 3 GB limit tsc died at a 1.5 GB heap.
# Keep the heap about 1 GB under VERIFY_MEMORY for native and buffer memory.
# The heap size is per node process and test workers inherit it, so a run with
# several jest/vitest workers that hits the ceiling may need fewer workers
# (--maxWorkers) rather than more memory.
#
# The repo is mounted at its own absolute path and the container runs as your
# uid, so caches (tsbuildinfo, vitest) and any file a run writes stay valid and
# owned by you on the host. Host networking lets specs reach the local test
# bed on 127.0.0.1:3308. Host environment variables are NOT passed in: specs
# read the repo's .env files like they do on the host, and the script refuses
# to run when any of them sets DATABASE_URL to the 3307 prod tunnel.
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

for env_file in "$REPO/.env" "$REPO/apps/web/.env" "$REPO/apps/api/.env" "$REPO/packages/db/.env"; do
  if [ -f "$env_file" ] && grep -Eq "^[[:space:]]*(export[[:space:]]+)?DATABASE_URL[[:space:]]*=.*:3307([/?\"' ]|$)" "$env_file"; then
    echo "verify: $env_file points DATABASE_URL at :3307 (the prod tunnel). Refusing." >&2
    exit 2
  fi
done

mkdir -p "$CACHE_DIR"

io_args=()
device="$(df --output=source "$REPO" | tail -n 1)"
parent="$(lsblk -no pkname "$device" 2>/dev/null | head -n 1 || true)"
if [ -n "$parent" ]; then
  device="/dev/$parent"
fi
if [ -b "$device" ] && [ "$(lsblk -dno type "$device" 2>/dev/null)" = "disk" ]; then
  io_args+=(--device-read-bps "$device:${VERIFY_READ_BPS:-150mb}")
  io_args+=(--device-write-bps "$device:${VERIFY_WRITE_BPS:-80mb}")
else
  echo "verify: could not resolve $device to a whole disk; running without disk bandwidth caps" >&2
fi

cpus="${VERIFY_CPUS:-4}"
host_cpus="$(nproc)"
if [ "${cpus%.*}" -gt "$host_cpus" ]; then
  cpus="$host_cpus"
fi

tty_args=()
if [ -t 1 ]; then
  tty_args+=(-t)
fi

exec docker run --rm --init "${tty_args[@]}" \
  --user "$(id -u):$(id -g)" \
  --network host \
  --memory "${VERIFY_MEMORY:-4g}" --memory-swap "${VERIFY_MEMORY:-4g}" \
  --cpus "$cpus" \
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
