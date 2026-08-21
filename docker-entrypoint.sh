#!/bin/sh
set -eu

# Hardened tmpfs mounts are empty at container start. Recreate the directory
# skeleton needed by nginx before dropping privileges to its worker.
mkdir -p /run/nginx /var/lib/nginx/tmp/client_body /var/lib/nginx/logs

# The host creates the bind mount. Keep analytics data private while allowing
# the unprivileged analytics process to update SQLite and published APKs.
mkdir -p /data /data/apks
chown -R nginx:nginx /data
chmod 0700 /data
find /data -maxdepth 1 -type f -exec chmod 0600 {} \;

exec "$@"
