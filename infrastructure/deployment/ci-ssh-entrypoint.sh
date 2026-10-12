#!/usr/bin/env bash
# ForcedCommand for the dedicated CI SSH key. No shell, file transfer,
# forwarding, or arbitrary server command is accepted.

set -Eeuo pipefail

fail() { printf '[restor-ci] ERROR: %s\n' "$1" >&2; exit 1; }

read -r action sha extra <<< "${SSH_ORIGINAL_COMMAND:-}"
[[ "$action" == deploy ]] || fail 'only the deploy command is allowed'
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid commit SHA'
[[ -z "${extra:-}" ]] || fail 'unexpected command arguments'

exec sudo -n /usr/local/sbin/restor-deploy "$sha"
