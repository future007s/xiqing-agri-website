#!/usr/bin/env bash
set -euo pipefail

set -a
. /srv/aeroponics/config/postgres.env
. /srv/aeroponics/config/website-publisher.env
set +a

exec /usr/bin/python3 /srv/aeroponics/app/website-publisher/website_publisher.py
