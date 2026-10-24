#!/usr/bin/env bash
set -euo pipefail
umask 077
IFS=$'\n\t'

die() {
	printf 'specgate restore failed: %s\n' "$1" >&2
	exit 1
}

require_value() {
	local name="$1"
	local value="${!name:-}"
	[[ -n "$value" ]] || die "required environment variable is missing"
}

require_value BACKUP_SET
require_value MYSQL_CONFIG
require_value MYSQL_DATABASE

[[ "${RESTORE_CONFIRM_EMPTY_TARGET:-}" == "I_UNDERSTAND_THIS_DATABASE_IS_EMPTY" ]] ||
	die "explicit empty-target confirmation is required"
[[ "$BACKUP_SET" == /* ]] || die "BACKUP_SET must be absolute"
[[ "$MYSQL_CONFIG" == /* ]] || die "MYSQL_CONFIG must be absolute"
[[ "$MYSQL_DATABASE" =~ ^[A-Za-z0-9_$-]{1,64}$ ]] || die "MYSQL_DATABASE is invalid"
[[ -d "$BACKUP_SET" ]] || die "BACKUP_SET is unavailable"
[[ -f "$MYSQL_CONFIG" ]] || die "MySQL option file is unavailable"

config_mode="$(stat -c '%a' "$MYSQL_CONFIG")"
(( (8#$config_mode & 8#077) == 0 )) || die "MySQL option file must not be group or world accessible"

for required_file in SHA256SUMS manifest.json mysql.sql.gz binlog.tsv; do
	[[ -f "$BACKUP_SET/$required_file" ]] || die "backup set is incomplete"
done

backup_root="$(readlink -f -- "$BACKUP_SET")"
[[ "$backup_root" != "/" ]] || die "BACKUP_SET cannot be the filesystem root"

(
	cd -- "$backup_root"
	sha256sum --check --strict SHA256SUMS >/dev/null
)

node -e '
const fs = require("node:fs");
const [file, database] = process.argv.slice(1);
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
if (
  manifest.version !== 1 ||
  manifest.backupType !== "full-and-binlog" ||
  manifest.database !== database ||
  manifest.dumpFile !== "mysql.sql.gz" ||
  manifest.binlogCoordinatesFile !== "binlog.tsv" ||
  !/^[a-f0-9]{64}$/i.test(manifest.dumpSha256)
) process.exit(1);
' "$backup_root/manifest.json" "$MYSQL_DATABASE"

table_count="$(mysql --defaults-extra-file="$MYSQL_CONFIG" -N -B -e \
	"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$MYSQL_DATABASE'")"
[[ "$table_count" == "0" ]] || die "target database is not empty"

gunzip -c -- "$backup_root/mysql.sql.gz" |
	mysql --defaults-extra-file="$MYSQL_CONFIG" "$MYSQL_DATABASE"

printf 'restore complete for empty target database\n'
