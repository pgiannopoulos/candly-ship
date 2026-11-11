#!/usr/bin/env bash
# Read-only check of the GT Courier "Hermes" API with your GT username/password.
# It logs in, asks a few harmless questions, and logs out. It creates NOTHING at GT.
# Usage:   bash scripts/gt-hermes-check.sh
set -uo pipefail
HOST="${GT_HOST:-https://login.gtcourier.gr}"
API="$HOST/hermes_api"

read -r -p "GT username: " GTUSER
read -r -s -p "GT password (hidden): " GTPASS; echo

echo; echo "== 1. Login"
# --form-string sends the password exactly as typed (plain -F treats ; @ < specially)
LOGIN=$(curl -s -X POST "$API/kernel/login" --form-string "username=$GTUSER" --form-string "password=$GTPASS" -F "type=json" -F "lang=GR")
unset GTPASS
SID=$(printf '%s' "$LOGIN" | sed -n 's/.*"sid" *: *"\([^"]*\)".*/\1/p')
if [ -z "$SID" ]; then
  echo "Login FAILED. GT answered:"; echo "$LOGIN"; exit 1
fi
echo "Login OK (session received, not shown)."

echo; echo "== 2. Session check (hello)"
curl -s "$API/pegapi00/hello?sid=$SID"; echo

echo; echo "== 3. Service areas for postcode 11633 (Athens)"
curl -s "$API/courier/make_zonearea?d23p01=GR&r21p02=11633&sid=$SID"; echo

echo; echo "== 4. Price for a 1 kg parcel to 54622 (Thessaloniki), all work types"
curl -s "$API/courier/calculate_cost?p126=2&p101=1&p0204country=GR&p0208=54622&sid=$SID"; echo

echo; echo "== 5. Voucher statuses (r14)"
curl -s "$API/courier/r14?sid=$SID"; echo

echo; echo "== 6. Your vouchers from the last month (first 2)"
curl -s "$API/courier/r18?recperpage=2&sid=$SID"; echo

echo; echo "== 7. Logout"
curl -s -X POST "$API/kernel/logout" -F "sid=$SID"; echo
unset SID
echo; echo "Done. Copy everything above (it contains no password or session) and paste it to Claude."
