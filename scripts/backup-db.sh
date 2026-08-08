#!/usr/bin/env bash
#
# Daily encrypted database backup to Cloudflare R2.
#
# Runs on the VPS host (where the `db` container lives), from cron. Dumps the
# database, compresses it, encrypts it, VERIFIES the result by decrypting it
# again, and only then uploads. Local artefacts are removed on success.
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
# RESTORE: see README §Database backups → Restore. Do not improvise it from
# memory; the documented procedure restores into a scratch database on purpose.

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

# Most objects a single run may delete. Retention removes at most one daily per
# day, so anything above a handful means the cutoff is wrong — a host clock jump
# forward, a botched edit — and the correct response is to refuse and shout, not
# to empty the bucket. Without this a clock skewed one year deleted every stored
# backup in one run.
MAX_PRUNE_PER_RUN="${ELORAE_BACKUP_MAX_PRUNE:-4}"

# Dump timeout. A dump blocked on a metadata lock never returns, and cron would
# start another every night: N concurrent 87 MB temp files and N pinned InnoDB
# snapshots on a box that has already filled its disk once.
DUMP_TIMEOUT="${ELORAE_BACKUP_TIMEOUT:-3h}"

log() { printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "FAILED: $*"; exit 1; }

# Single instance. Belt to the timeout's braces: if a run somehow outlives its
# timeout, the next night exits immediately rather than piling on.
LOCK_FILE="${ELORAE_BACKUP_LOCK:-/tmp/elorae-backup.lock}"
if [ "${ELORAE_BACKUP_LOCKED:-}" != "1" ]; then
  export ELORAE_BACKUP_LOCKED=1
  exec flock -n "$LOCK_FILE" "$0" "$@" || {
    printf '%s [backup] FAILED: another backup run holds %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$LOCK_FILE"
    exit 1
  }
fi

[ -r "$ENV_FILE" ] || die "missing config: $ENV_FILE (see the SETUP block in this script)"
[ -r "$PASSPHRASE_FILE" ] || die "missing passphrase: $PASSPHRASE_FILE"

# Both files hold material that reads the backups (passphrase) or deletes them
# (R2 token). Refuse to run on modes that let any other local account read them —
# a warning would be ignored forever, and the fix is one chmod.
for secret in "$PASSPHRASE_FILE" "$ENV_FILE"; do
  mode="$(stat -c %a "$secret")"
  case "$mode" in
    600|400) ;;
    *) die "$secret is mode $mode — must be 600. Run: chmod 600 $secret" ;;
  esac
done

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

: "${R2_ACCOUNT_ID:?not set in $ENV_FILE}"
: "${R2_BACKUP_BUCKET:?not set in $ENV_FILE}"
: "${AWS_ACCESS_KEY_ID:?not set in $ENV_FILE}"
: "${AWS_SECRET_ACCESS_KEY:?not set in $ENV_FILE}"

# The application's buckets are PUBLIC-READ — they serve item images and visit
# photos over a pub-*.r2.dev URL. Uploading a customer database there, even
# encrypted, publishes it at a guessable key with no error and no warning. The
# realistic mistake is reusing the app's broad token and typing its bucket name,
# so those names are refused outright rather than documented against.
case "$R2_BACKUP_BUCKET" in
  elorae-erp|elorae-uploads)
    die "R2_BACKUP_BUCKET is '$R2_BACKUP_BUCKET', which is an application bucket and is PUBLIC-READ. Backups need their own private bucket." ;;
esac

R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
s3() { aws s3 --endpoint-url "$R2_ENDPOINT" "$@"; }
s3api() { aws s3api --endpoint-url "$R2_ENDPOINT" "$@"; }

command -v aws >/dev/null || die "aws cli not installed (apt-get install -y awscli)"
command -v gpg >/dev/null || die "gpg not installed (apt-get install -y gnupg)"

STAMP="$(date -u +%Y-%m-%d)"
[[ "$STAMP" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "date(1) produced '$STAMP', refusing to run"

WORK_DIR="$(mktemp -d)"
chmod 700 "$WORK_DIR"
ARCHIVE="$WORK_DIR/elorae-${STAMP}.sql.gz.gpg"
KEEP_ARCHIVE=0

# Local artefacts are not kept on success: this VPS filled its 96 GB disk once
# already, and a stale 87 MB dump a day is exactly how that happens again. On
# FAILURE the archive is kept, because it is the one piece of evidence that
# identifies which failure class occurred.
cleanup() {
  if [ "$KEEP_ARCHIVE" = "1" ] && [ -f "$ARCHIVE" ]; then
    local kept="${TMPDIR:-/tmp}/elorae-backup-failed-${STAMP}.sql.gz.gpg"
    mv -f "$ARCHIVE" "$kept" 2>/dev/null && log "kept the failed archive at $kept for diagnosis"
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

log "dumping database"
# `pipefail` makes a dump failure fail the whole pipeline rather than being
# masked by gzip's success. `--single-transaction` keeps it lock-free on InnoDB;
# `--skip-ssl` is required because MariaDB 11.4's client demands TLS by default
# and this server offers none. gpg's own compression is off: the stream is
# already gzipped, so it would burn CPU for nothing.
#
# The password goes via MYSQL_PWD, not `-p`, and the inner command is single
# quoted so it expands inside the container and never on this host. `-p<secret>`
# would put it in the container's argv, and /proc/<pid>/cmdline is world-readable
# — any local account could read the DB root password during the nightly window.
# The process environment is 0400, readable only by its own user.
timeout "$DUMP_TIMEOUT" docker compose -f "$COMPOSE_FILE" exec -T db \
  sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb-dump --skip-ssl -u root --single-transaction --quick --routines elorae' \
  | gzip \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --compress-algo none \
        --passphrase-file "$PASSPHRASE_FILE" -o "$ARCHIVE" \
  || { KEEP_ARCHIVE=1; die "dump/encrypt pipeline failed"; }

SIZE="$(stat -c %s "$ARCHIVE")"
log "wrote archive ($SIZE bytes)"
[ "$SIZE" -ge "$MIN_BYTES" ] || { KEEP_ARCHIVE=1; die "archive is $SIZE bytes, below the $MIN_BYTES floor — treating as a truncated dump"; }

# The real check. Decrypt and decompress what was just written and confirm the
# LAST line is the trailer mariadb-dump emits only after a complete run. This
# proves three things at once: the passphrase works, the gzip stream is intact,
# and the dump is not truncated. An exit status proves none of them.
#
# Matched against the final line specifically, not a substring of the tail: row
# data containing that literal would otherwise vouch for a truncated dump.
log "verifying archive by decrypting it"
LAST_LINE="$(gpg --batch --quiet --decrypt --passphrase-file "$PASSPHRASE_FILE" "$ARCHIVE" | gunzip | tail -n 1)" \
  || { KEEP_ARCHIVE=1; die "archive could not be decrypted and decompressed"; }
case "$LAST_LINE" in
  "-- Dump completed on "*) log "verified: $LAST_LINE" ;;
  *) KEEP_ARCHIVE=1; die "archive did not decrypt to a complete dump (last line was: ${LAST_LINE:-<empty>})" ;;
esac

KEY="elorae-${STAMP}.sql.gz.gpg"
log "uploading to s3://${R2_BACKUP_BUCKET}/daily/${KEY}"
s3 cp "$ARCHIVE" "s3://${R2_BACKUP_BUCKET}/daily/${KEY}" --only-show-errors || die "upload failed"

# Confirm the object landed at the size we sent. `cp` reporting success does not
# prove the bytes are retrievable, and every later "verified" claim rests on this
# object rather than on the local file, which is about to be deleted.
REMOTE_SIZE="$(s3api head-object --bucket "$R2_BACKUP_BUCKET" --key "daily/${KEY}" --query ContentLength --output text 2>/dev/null || echo "")"
[ "$REMOTE_SIZE" = "$SIZE" ] || die "uploaded object is '${REMOTE_SIZE:-missing}' bytes, expected $SIZE"
log "upload confirmed at $REMOTE_SIZE bytes"

# Keep one long-retention copy per month. Promoted whenever this month has none
# yet, rather than only on the 1st: a single failed run on the 1st would
# otherwise cost that month's restore point permanently, since the daily is
# pruned 14 days later and nothing backfills it.
MONTH_PREFIX="elorae-$(date -u +%Y-%m)"
if ! s3 ls "s3://${R2_BACKUP_BUCKET}/monthly/${MONTH_PREFIX}" >/dev/null 2>&1; then
  log "no monthly copy for $(date -u +%Y-%m) yet — promoting today's"
  s3 cp "s3://${R2_BACKUP_BUCKET}/daily/${KEY}" "s3://${R2_BACKUP_BUCKET}/monthly/${KEY}" --only-show-errors \
    || log "WARNING: monthly promotion failed — the daily copy is uploaded and safe"
fi

# Prune by the date encoded in the key, not by R2's LastModified: a copied or
# re-uploaded object carries a fresh timestamp and would survive forever.
#
# Deliberately fail-soft. Retention is housekeeping; the backup is already
# uploaded and confirmed by this point, so a prune problem must not abort the run
# and must never be mistaken for a backup failure. It also must never delete
# more than a day's worth in one pass — see MAX_PRUNE_PER_RUN.
prune() {
  prefix="$1"; keep_days="$2"
  cutoff="$(date -u -d "${keep_days} days ago" +%Y-%m-%d 2>/dev/null || true)"

  if ! [[ "$cutoff" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    log "WARNING: could not compute a ${prefix} cutoff (got '${cutoff:-<empty>}') — skipping prune"
    return 0
  fi
  # A cutoff at or after today would delete everything including today's upload.
  if ! [[ "$cutoff" < "$STAMP" ]]; then
    log "WARNING: ${prefix} cutoff $cutoff is not older than today ($STAMP) — refusing to prune; check the host clock"
    return 0
  fi

  listing="$(s3 ls "s3://${R2_BACKUP_BUCKET}/${prefix}/" 2>/dev/null || true)"
  if [ -z "$listing" ]; then
    log "nothing stored under ${prefix}/ — nothing to prune"
    return 0
  fi

  doomed="$(printf '%s\n' "$listing" | awk '{print $4}' | while read -r key; do
    [ -n "$key" ] || continue
    case "$key" in elorae-*.sql.gz.gpg) ;; *) continue ;; esac
    keydate="${key#elorae-}"; keydate="${keydate%%.sql.gz.gpg}"
    case "$keydate" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) continue ;; esac
    [[ "$keydate" < "$cutoff" ]] && printf '%s\n' "$key"
  done)"

  [ -n "$doomed" ] || { log "${prefix}/ has nothing older than $cutoff"; return 0; }

  count="$(printf '%s\n' "$doomed" | wc -l)"
  if [ "$count" -gt "$MAX_PRUNE_PER_RUN" ]; then
    log "WARNING: ${prefix}/ prune would delete $count objects (limit $MAX_PRUNE_PER_RUN) — refusing."
    log "WARNING: that means the cutoff is wrong, not that retention is overdue. Check the host clock, then prune by hand if genuinely needed."
    return 0
  fi

  printf '%s\n' "$doomed" | while read -r key; do
    log "pruning ${prefix}/$key"
    s3 rm "s3://${R2_BACKUP_BUCKET}/${prefix}/${key}" --only-show-errors || log "WARNING: prune failed for $key"
  done
}

prune daily "$DAILY_KEEP_DAYS" || log "WARNING: daily prune exited nonzero — backup itself is safe"
prune monthly "$MONTHLY_KEEP_DAYS" || log "WARNING: monthly prune exited nonzero — backup itself is safe"

log "OK — backup complete, verified and uploaded ($SIZE bytes)"
