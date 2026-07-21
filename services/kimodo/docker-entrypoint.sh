#!/usr/bin/env bash
set -euo pipefail

if [[ -f /run/secrets/hf_token ]]; then
  export HF_TOKEN="$(tr -d '\r\n' < /run/secrets/hf_token)"
fi

exec "$@"
