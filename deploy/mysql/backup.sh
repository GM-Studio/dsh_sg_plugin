#!/usr/bin/env bash
set -euo pipefail
umask 077
IFS=$'\n\t'

die() {
	printf 'specgate backup failed: %s\n' "$1" >&2
	exit 1
}

require_value() {
	local name="$1"
	local value="${!name:-}"
	[[ -n "$value" ]] || die "required environment variable is missing"
}

require_value BACKUP_DIR
require_value BACKUP_RETENTION_DAYS
require_value MYSQL_CONFIG
require_value MYSQL_DATABASE
require_value BACKUP_RPO_TARGET_MINUTES
require_value BACKUP_RTO_TARGET_MINUTES

[[ "$BACKUP_DIR" == /* ]] || die "BACKUP_DIR must be absolute"
[[ "$MYSQL_CONFIG" == /* ]] || die "MYSQL_CONFIG must be absolute"
[[ "$MYSQL_DATABASE" =~ ^[A-Za-z0-9_$-]{1,64}$ ]] || die "MYSQL_DATABASE is invalid"
[[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "BACKUP_RETENTION_DAYS is invalid"
(( BACKUP_RETENTION_DAYS >= 1 && BACKUP_RETENTION_DAYS <= 3650 )) ||
	die "BACKUP_RETENTION_DAYS is outside the bounded range"
[[ "$BACKUP_RPO_TARGET_MINUTES" =~ ^[0-9]+$ ]] || die "RPO target is invalid"
[[ "$BACKUP_RTO_TARGET_MINUTES" =~ ^[0-9]+$ ]] || die "RTO target is invalid"
(( BACKUP_RPO_TARGET_MINUTES >= 1 && BACKUP_RPO_TARGET_MINUTES <= 15 )) ||
	die "RPO target is outside the approved range"
(( BACKUP_RTO_TARGET_MINUTES >= 1 && BACKUP_RTO_TARGET_MINUTES <= 120 )) ||
	die "RTO target is outside the approved range"

[[ -f "$MYSQL_CONFIG" ]] || die "MySQL option file is unavailable"
config_mode="$(stat -c '%a' "$MYSQL_CONFIG")"
(( (8#$config_mode & 8#077) == 0 )) || die "MySQL option file must not be group or world accessible"

mkdir --parents -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"
backup_root="$(readlink -f -- "$BACKUP_DIR")"
[[ "$backup_root" != "/" ]] || die "BACKUP_DIR cannot be the filesystem root"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_name="specgate-backup-$timestamp"
partial_dir="$backup_root/.tmp-$backup_name-$$"
final_dir="$backup_root/$backup_name"

cleanup() {
	if [[ -n "${partial_dir:-}" && "$partial_dir" == "$backup_root"/.tmp-specgate-backup-* ]]; then
		rm -rf -- "$partial_dir"
	fi
}
trap cleanup EXIT

mkdir -m 700 -- "$partial_dir"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dump_file="$partial_dir/mysql.sql.gz"
binlog_file="$partial_dir/binlog.tsv"

mysqldump --defaults-extra-file="$MYSQL_CONFIG" \
	--single-transaction \
	--source-data=2 \
	--routines \
	--events \
	--triggers \
	--hex-blob \
	--set-gtid-purged=OFF \
	"$MYSQL_DATABASE" | gzip -9 >"$dump_file"

if ! mysql --defaults-extra-file="$MYSQL_CONFIG" -N -B -e 'SHOW BINARY LOG STATUS' \
	>"$binlog_file" 2>/dev/null; then
	mysql --defaults-extra-file="$MYSQL_CONFIG" -N -B -e 'SHOW MASTER STATUS' \
		>"$binlog_file" 2>/dev/null || die "binlog coordinates are unavailable"
fi
[[ -s "$binlog_file" ]] || die "binlog coordinates are unavailable"

completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dump_sha256="$(sha256sum "$dump_file" | awk '{print $1}')"
dump_bytes="$(wc -c <"$dump_file" | tr -d '[:space:]')"

printf '%s\n' \
	'{' \
	'  "version": 1,' \
	'  "backupType": "full-and-binlog",' \
	"  \"startedAt\": \"$started_at\"," \
	"  \"completedAt\": \"$completed_at\"," \
	"  \"database\": \"$MYSQL_DATABASE\"," \
	'  "dumpFile": "mysql.sql.gz",' \
	'  "binlogCoordinatesFile": "binlog.tsv",' \
	"  \"dumpBytes\": $dump_bytes," \
	"  \"dumpSha256\": \"$dump_sha256\"," \
	"  \"rpoTargetMinutes\": $BACKUP_RPO_TARGET_MINUTES," \
	"  \"rtoTargetMinutes\": $BACKUP_RTO_TARGET_MINUTES," \
	"  \"retentionDays\": $BACKUP_RETENTION_DAYS" \
	'}' >"$partial_dir/manifest.json"

(
	cd -- "$partial_dir"
	sha256sum mysql.sql.gz binlog.tsv manifest.json >SHA256SUMS
)

mv -- "$partial_dir" "$final_dir"
partial_dir=""

while IFS= read -r old_backup; do
	[[ "$(dirname -- "$old_backup")" == "$backup_root" ]] ||
		die "retention candidate escaped BACKUP_DIR"
	[[ -d "$old_backup" && ! -L "$old_backup" ]] || continue
	rm -rf -- "$old_backup"
done < <(
	find "$backup_root" -mindepth 1 -maxdepth 1 -type d \
		-name 'specgate-backup-*' -mtime +"$BACKUP_RETENTION_DAYS" -print
)

printf 'backup complete: %s\n' "$final_dir"
printf 'sha256: %s\n' "$dump_sha256"
