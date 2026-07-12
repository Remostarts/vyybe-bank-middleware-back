#!/bin/sh
# Generates /blnk.json from environment variables at container start.
# Required: BLNK_DB_URL, BLNK_REDIS_DNS, TYPESENSE_URL, TYPESENSE_API_KEY, BLNK_SECRET_KEY
set -eu

: "${BLNK_DB_URL:?BLNK_DB_URL is required}"
: "${BLNK_REDIS_DNS:?BLNK_REDIS_DNS is required}"
: "${TYPESENSE_URL:?TYPESENSE_URL is required}"
: "${TYPESENSE_API_KEY:?TYPESENSE_API_KEY is required}"
: "${BLNK_SECRET_KEY:?BLNK_SECRET_KEY is required}"

cat > /blnk.json <<EOF
{
  "project_name": "VyyBe",
  "data_source": { "dns": "${BLNK_DB_URL}" },
  "redis": { "dns": "${BLNK_REDIS_DNS}" },
  "typesense": { "dns": "${TYPESENSE_URL}" },
  "type_sense_key": "${TYPESENSE_API_KEY}",
  "server": { "port": "5001", "secure": true, "secret_key": "${BLNK_SECRET_KEY}" }
}
EOF

exec "$@"
