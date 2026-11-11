#!/usr/bin/env bash
# Creates the production .env for Candly Ship on the server.
# Usage (from the repo folder):   bash scripts/make-env.sh
# Secrets are generated here on the server; passwords are typed hidden and never stored in plain text.
set -euo pipefail
cd "$(dirname "$0")/.."

OLD_PG=""; OLD_SECRET=""
if [ -f .env ]; then
  read -r -p ".env already exists. Overwrite it? (y/N) " ans
  [ "${ans:-N}" = "y" ] || { echo "Aborted, .env unchanged."; exit 1; }
  # Keep these: the database was created with this password, and APP_SECRET encrypts the stored GT login.
  OLD_PG=$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2- || true)
  OLD_SECRET=$(grep -E '^APP_SECRET=' .env | cut -d= -f2- || true)
  cp .env ".env.backup-$(date +%Y%m%d-%H%M%S)"
  echo "Backup saved. Keeping the existing database password and app secret."
fi

read -r -s -p "New admin password for the app: " ADMINPW; echo
read -r -s -p "Repeat admin password: " ADMINPW2; echo
[ "$ADMINPW" = "$ADMINPW2" ] || { echo "Passwords do not match. Run the script again."; exit 1; }
[ ${#ADMINPW} -ge 10 ] || { echo "Please use at least 10 characters. Run the script again."; exit 1; }
read -r -p "Shopify Client ID: " SHOP_ID
read -r -s -p "Shopify Client secret: " SHOP_SECRET; echo
[ -n "$SHOP_ID" ] && [ -n "$SHOP_SECRET" ] || { echo "Shopify Client ID/secret are required."; exit 1; }

echo "Hashing admin password..."
HASH=$(docker run --rm -e PW="$ADMINPW" node:22-alpine sh -c \
  'cd /tmp && npm i --silent bcryptjs >/dev/null 2>&1 && node -e "console.log(Buffer.from(require(\"bcryptjs\").hashSync(process.env.PW,12)).toString(\"base64\"))"')
[ -n "$HASH" ] || { echo "Hashing failed."; exit 1; }

umask 077
{
  echo "APP_URL=https://ship.candly.gr"
  echo "APP_SECRET=${OLD_SECRET:-$(openssl rand -hex 32)}"
  echo "ADMIN_PASSWORD_HASH=$HASH"
  echo "POSTGRES_PASSWORD=${OLD_PG:-$(openssl rand -hex 24)}"
  echo "SHOPIFY_STORE_DOMAIN=candly-6712.myshopify.com"
  echo "SHOPIFY_API_VERSION=2026-10"
  echo "SHOPIFY_ADMIN_TOKEN="
  echo "SHOPIFY_CLIENT_ID=$SHOP_ID"
  echo "SHOPIFY_CLIENT_SECRET=$SHOP_SECRET"
  echo "SHOPIFY_WEBHOOK_SECRET=$SHOP_SECRET"
  echo "GT_API_HOST=https://login.gtcourier.gr"
  echo "GT_MOCK=0"
} > .env
chmod 600 .env
unset ADMINPW ADMINPW2 SHOP_SECRET HASH

echo
echo "✓ .env created. Summary (secrets shown as length only):"
awk '{ k=substr($0,1,index($0,"=")-1); v=substr($0,index($0,"=")+1);
       if (k ~ /SECRET|HASH|PASSWORD|CLIENT_ID/) print "  " k "=" (length(v) ? "(" length(v) " chars)" : "(EMPTY)");
       else print "  " $0 }' .env
