#!/usr/bin/env bash
#
# Daily encrypted database backup to Cloudflare R2.
#
# Runs on the VPS host (where the `db` container lives), from cron. Dumps the
# database, compresses it, encrypts it, VERIFIES the result by decrypting it
# again, and only then uploads. Local artefacts are removed either way.
#
# Why the verify step exists: on 2026-08-08 a hand-run backup produced a valid
# 123-byte gzip and reported success. `mariadb-dump | gzip` returns GZIP's exit
# status, so a dump that fails outright still exits 0 with a plausible-looking
# file. Two separate causes hit that day — a password prompt with no TTY, then
# MariaDB 11.4 requiring TLS the server does not offer. Neither was visible
# without opening the file. So this script never trusts an exit status: it
# decrypts what it just wrote and looks for the dump's own completion trailer.
#
# ENCRYPTION: gpg symmetric AES-256. The passphrase file is the ONLY way to
# read these backups. Losing it loses every backup. Keep a copy somewhere that
# is neither this server nor the backup bucket.
#
# The target bucket MUST be private. The application's own R2 bucket is
# public-read (it serves item images and visit photos over a pub-*.r2.dev URL);
# a database dump there would expose every customer's name, address, phone and
# order history to anyone who guesses a key. Use a separate bucket.
#
# SETUP (once, on the VPS):
#   sudo apt-get install -y awscli gnupg
#   install -m 700 -d ~/.elorae-backup
#   printf '%s' 'a-long-random-passphrase' > ~/.elorae-backup/passphrase
#   chmod 600 ~/.elorae-backup/passphrase
#   cp scripts/backup-db.env.example ~/.elorae-backup/env   # then fill it in
#   chmod 600 ~/.elorae-backup/env
#
# CRON (daily 02:15 WIB — the VPS runs UTC, so 19:15 UTC the previous day):
#   15 19 * * * /srv/elorae/scripts/backup-db.sh >> /home/elorae/backup.log 2>&1
#
# RESTORE:
#   aws s3 cp s3://<bucket>/daily/<file> . --endpoint-url "$R2_ENDPOINT"
#   gpg --batch --decrypt --passphrase-file ~/.elorae-backup/passphrase <file> \
#     | gunzip | docker compose -f /srv/elorae/docker-compose.prod.yml exec -T db \
#       mariadb --skip-ssl -u root -p"$MARIADB_ROOT_PASSWORD" elorae
#   Restore into a scratch database first and inspect it. Never straight over prod.

set -euo pipefail

CONFIG_DIR="${ELORAE_BACKUP_DIR:-$HOME/.elorae-backup}"
PASSPHRASE_FILE="$CONFIG_DIR/passphrase"
ENV_FILE="$CONFIG_DIR/env"
COMPOSE_FILE="${ELORAE_COMPOSE_FILE:-/srv/elorae/docker-compose.prod.yml}"

# Minimum plausible size for the encrypted artefact. The real dump compresses to
# ~87 MB; anything under 20 MB means the dump was truncated or empty, which is
# precisely the failure this script exists to catch. Raise it as the data grows.
MIN_BYTES="${ELORAE_BACKUP_MIN_BYTES:-20000000}"

DAILY_KEEP_DAYS=14
MONTHLY_KEEP_DAYS=186

log() { printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "FAILED: $*"; exit 1; }

[ -r "$ENV_FILE" ] || die "missing config: $ENV_FILE (see the SETUP block in this script)"
[ -r "$PASSPHRASE_FILE" ] || die "missing passphrase: $PASSPHRASE_FILE"

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

: "${R2_ACCOUNT_ID:?not set in $ENV_FILE}"
: "${R2_BACKUP_BUCKET:?not set in $ENV_FILE}"
: "${AWS_ACCESS_KEY_ID:?not set in $ENV_FILE}"
: "${AWS_SECRET_ACCESS_KEY:?not set in $ENV_FILE}"

R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
S3="aws s3 --endpoint-url $R2_ENDPOINT"

command -v aws >/dev/null || die "aws cli not installed (apt-get install -y awscli)"
command -v gpg >/dev/null || die "gpg not installed (apt-get install -y gnupg)"

STAMP="$(date -u +%Y-%m-%d)"
WORK_DIR="$(mktemp -d)"
# Local artefacts are never kept: this VPS filled its 96 GB disk once already,
# and a stale 87 MB dump a day is exactly how that happens again.
trap 'rm -rf "$WORK_DIR"' EXIT

ARCHIVE="$WORK_DIR/elorae-${STAMP}.sql.gz.gpg"

log "dumping database"
# `pipefail` makes a dump failure fail the whole pipeline rather than being
# masked by gzip's success. `--single-transaction` keeps it lock-free on InnoDB;
# `--skip-ssl` is required because MariaDB 11.4's client demands TLS by default
# and this server offers none. gpg's own compression is off: the stream is
# already gzipped, so it would burn CPU for nothing.
docker compose -f "$COMPOSE_FILE" exec -T db \
  sh -c 'mariadb-dump --skip-ssl -u root -p"$MARIADB_ROOT_PASSWORD" --single-transaction --quick --routines elorae' \
  | gzip \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --compress-algo none \
        --passphrase-file "$PASSPHRASE_FILE" -o "$ARCHIVE" \
  || die "dump/encrypt pipeline failed"

SIZE="$(stat -c %s "$ARCHIVE")"
log "wrote $ARCHIVE ($SIZE bytes)"
[ "$SIZE" -ge "$MIN_BYTES" ] || die "archive is $SIZE bytes, below the $MIN_BYTES floor — treating as a truncated dump"

# The real check. Decrypt and decompress what was just written and look for the
# trailer mariadb-dump emits ONLY after a complete run. This proves three things
# at once: the passphrase works, the gzip stream is intact, and the dump is not
# truncated. An exit status proves none of them.
log "verifying archive by decrypting it"
gpg --batch --quiet --decrypt --passphrase-file "$PASSPHRASE_FILE" "$ARCHIVE" \
  | gunzip \
  | tail -c 4096 \
  | grep -q 'Dump completed on' \
  || die "archive did not decrypt to a complete dump (no 'Dump completed on' trailer)"

log "uploading to s3://${R2_BACKUP_BUCKET}/daily/"
$S3 cp "$ARCHIVE" "s3://${R2_BACKUP_BUCKET}/daily/elorae-${STAMP}.sql.gz.gpg" --only-show-errors \
  || die "upload failed"

# Keep the 1st of each month as a long-retention copy. Copied server-side rather
# than uploaded twice.
if [ "$(date -u +%d)" = "01" ]; then
  log "first of month — copying to monthly/"
  $S3 cp "s3://${R2_BACKUP_BUCKET}/daily/elorae-${STAMP}.sql.gz.gpg" \
         "s3://${R2_BACKUP_BUCKET}/monthly/elorae-${STAMP}.sql.gz.gpg" --only-show-errors \
    || log "WARNING: monthly copy failed — the daily copy is uploaded and safe"
fi

# Prune by the date encoded in the key, not by R2's LastModified: a re-uploaded
# or copied object carries a fresh timestamp and would survive forever.
prune() {
  local prefix="$1" keep_days="$2" cutoff
  cutoff="$(date -u -d "${keep_days} days ago" +%Y-%m-%d)"
  $S3 ls "s3://${R2_BACKUP_BUCKET}/${prefix}/" | awk '{print $4}' | while read -r key; do
    [ -n "$key" ] || continue
    local keydate="${key#elorae-}"; keydate="${keydate%%.sql.gz.gpg}"
    case "$keydate" in
      [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
      *) log "skipping unrecognised key in ${prefix}/: $key"; continue ;;
    esac
    if [[ "$keydate" < "$cutoff" ]]; then
      log "pruning ${prefix}/$key"
      $S3 rm "s3://${R2_BACKUP_BUCKET}/${prefix}/${key}" --only-show-errors || log "WARNING: prune failed for $key"
    fi
  done
}

prune daily "$DAILY_KEEP_DAYS"
prune monthly "$MONTHLY_KEEP_DAYS"

log "OK — backup complete and verified ($SIZE bytes)"
