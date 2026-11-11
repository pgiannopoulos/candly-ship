# Candly Ship ✦ Shopify → GT Courier

A small, quiet back-office for **candly.gr**: new Shopify orders arrive automatically, the admin checks the address and **issues the voucher to GT Courier** with one click. GT then emails the carrier's voucher (the label for the package) by its own process — this app does not print anything.

- **Reads only** from Shopify (it never changes orders there).
- Talks to GT Courier through their **Pegasus Hermes REST API** (docs: https://www.tesae.gr/pegasus-hermes-rest-api, guide in `docs/hermes-api-guide.md`).
- Handles **cash on delivery (αντικαταβολή)**: the amount is pre-filled from Shopify and sent with the voucher.
- UI in Greek, in Candly's palette (cream `#fffaf6`, burgundy `#4a1219`, terracotta `#b4532a`, Manrope).

---

## 1. How it works

```
Customer orders on candly.gr
        │  Shopify webhook (orders/create · updated · cancelled)  + backup sync every 10 min
        ▼
Candly Ship  ──  orders inbox  →  "Έκδοση voucher"  →  make_zonearea + POST /hermes_api/courier/r18  (GT Hermes)
                                                        ↓
                                   GT emails the carrier's voucher to Candly (outside this app)
```

Order states in the app:

| State | Meaning |
|---|---|
| **Νέα** | Waiting for a voucher |
| **Σφάλμα** | GT rejected the voucher. The message is shown, so fix the problem and retry |
| **Εκδόθηκε** | Voucher issued at GT (its number is shown). GT emails the carrier's voucher |
| **Ακυρώθηκε** | Cancelled in Shopify before a voucher was made |
| **Παράλειψη** | No shipping needed (pickup, digital, already fulfilled) or skipped by the admin |

---

## 2. Before you start: GT Courier API access

GT gives you a **Hermes API username and password** (separate from the website login). You enter them in the app under **Ρυθμίσεις → GT Courier**; they're checked with GT and stored encrypted. GT also provides a test account (`DEMO`) for trying things out.

Everything else is optional — GT applies your account's defaults:

| Setting | Field | What it is |
|---|---|---|
| Είδος εργασίας | `p04` | `001` = sender pays, `002` = recipient pays. Empty = GT's first applicable |
| Κατάσταση ακύρωσης | `p014` | Status that cancels a voucher (GT's list has `AKY` "Ακύρωση Εργασίας") |
| Αποστολέας | `p0101…p0110` | Leave the address empty to use the details of your GT account |

**Cancelling:** with the current account GT accepts `p014=AKY` but does not change the status. The app checks GT after every cancel and tells you honestly whether GT cancelled it; if not, cancel it with GT as well. Still to confirm with GT: how to cancel through the API.

---

## 3. One-time setup

### 3.1 Shopify custom app (read-only)

1. Shopify **Dev Dashboard** → *Create app* → name it "Candly Ship".
2. Under **Configuration**, set the Admin API scopes to **`read_orders`**.
3. **Protected customer data**: request access to *name, address, phone, email*. This is needed so orders include the shipping address.
4. **Install** the app on the candly store.
5. Copy the credentials into `.env`:
   - `SHOPIFY_STORE_DOMAIN` = `xxxx.myshopify.com`
   - either `SHOPIFY_ADMIN_TOKEN` (an `shpat_…` token), **or** `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`
   - `SHOPIFY_WEBHOOK_SECRET` = the app's client secret

You don't need to create webhooks by hand. The app registers `orders/create`, `orders/updated` and `orders/cancelled` itself when it starts.

### 3.2 Server (existing Linux server with nginx + Docker)

The app and its own Postgres run in Docker (`docker-compose.prod.yml`) and listen **only on `127.0.0.1:3100`**. The server's nginx serves `ship.candly.gr` over HTTPS (certbot) and proxies to it, so it can share a server with other sites.

```bash
# 1. DNS (papaki): A record  ship → <server IPv4>   (+ AAAA if the server has IPv6)

# 2. Code
sudo mkdir -p /opt/candly-ship && sudo chown $USER /opt/candly-ship
git clone https://github.com/pgiannopoulos/candly-ship.git /opt/candly-ship
cd /opt/candly-ship && cp .env.example .env && chmod 600 .env

# 3. Fill .env  (APP_URL=https://ship.candly.gr, APP_SECRET, ADMIN_PASSWORD_HASH,
#    POSTGRES_PASSWORD, Shopify vars, GT_API_HOST=https://login.gtcourier.gr, GT_MOCK=0)
#    (or simply: bash scripts/make-env.sh)
nano .env

# 4. Start app + database
docker compose -f docker-compose.prod.yml up -d --build
curl -s http://127.0.0.1:3100/api/health        # → {"ok":true}

# 5. nginx + HTTPS
sudo cp deploy/nginx/ship.candly.gr.conf /etc/nginx/sites-available/ship.candly.gr
sudo ln -s /etc/nginx/sites-available/ship.candly.gr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ship.candly.gr
```

**Updating:** `cd /opt/candly-ship && git pull && docker compose -f docker-compose.prod.yml up -d --build`
**Logs:** `docker compose -f docker-compose.prod.yml logs -f app`
**Backup:** `docker compose -f docker-compose.prod.yml exec db pg_dump -U candly candly_ship > backup-$(date +%F).sql`

### 3.3 First login

1. Open **https://ship.candly.gr** and log in with the admin password.
2. Go to **Ρυθμίσεις → GT Courier**, type the Hermes API **username and password** and click **Σύνδεση**. The app checks them with GT and shows "Συνδεδεμένο ως …". It logs in again by itself whenever the GT session expires; if the password changes, enter the new one here.
3. Optionally fill in the **GT codes** and the **sender** (see section 2) and the **defaults** (pieces, weight). Click **Αποθήκευση**.
4. Click **Συγχρονισμός τώρα**. This loads orders from the last 14 days.
5. **Ρυθμίσεις → Διάγνωση GT** shows your latest real vouchers and GT's status codes, to confirm the codes.
6. **Test voucher:** issue a voucher for one order and check that GT's email with the carrier's voucher arrives. Cancel it if it was only a test.

---

## 4. Daily use

1. **Open the app.** New orders appear in **Νέες** automatically; the list refreshes every 20 seconds, with a "✦ 1 νέα παραγγελία" notice.
2. **Click an order** to open it on the right:
   - Check the **address and phone**. If something is wrong (a typo, missing floor), click **Διόρθωση**. The fix only applies to the voucher, not Shopify.
   - **Περιοχή GT**: GT splits postcodes into service areas. The app picks the one matching the city; when a postcode is ambiguous it's highlighted and you choose from the list.
   - **Pieces / weight**: pre-filled (the weight comes from the Shopify product weights).
   - **Αντ/λή (€)**: pre-filled for COD orders and shown with a terracotta badge. Leave it at 0 for prepaid orders.
   - Optionally add **notes for the courier**.
   - Click **Έκδοση voucher**. When GT accepts it, the GT voucher number appears in green ("✓ Εκδόθηκε στο GT Courier") and the order moves to **Εκδόθηκαν**.
3. **GT emails the carrier's voucher** for the package. That part happens outside the app.
4. **For many orders at once:** tick them in the list and use **Έκδοση vouchers (n)**.
5. **In Shopify**, mark the order as fulfilled yourself. The app never touches Shopify.

**Keyboard shortcuts:** `j`/`k` move · `x` select · `Enter` open · `v` issue voucher · `/` search · `Esc` close.

**If something goes wrong:**

| You see | Do |
|---|---|
| Red **Σφάλμα** with GT's message | Open the order, fix the field (usually the postcode or phone), then **Έκδοση voucher** again |
| "Λείπει τηλέφωνο / Μη έγκυρος ΤΚ" | Use **Διόρθωση** to fill it in |
| Red dot next to *GT Courier* in the header | The GT login failed (password changed?). Go to **Ρυθμίσεις → GT Courier** and enter it again |
| "Ο ΤΚ ανήκει σε περισσότερες περιοχές GT" | Choose **Περιοχή GT** in the order, then issue the voucher again |
| An order is missing | Click **↻** (sync) in the list |
| A customer cancelled after the voucher was issued | The order shows a warning. Click **Ακύρωση** in the order. The notice says whether GT cancelled it too; if not, cancel it with GT |
| A store-pickup order | It's skipped automatically. You can also use **Παράλειψη** |

Issuing a voucher twice is safe: if GT already has a voucher for that order number, the app reuses it instead of creating a duplicate.

---

## 5. Development

```bash
npm install
cp .env.example .env          # set GT_MOCK=1 to work without GT
npm run db:up                 # Postgres in Docker on localhost:5432 (docker-compose.yml = dev only)
npm run db:push               # create tables
npm run seed:demo             # 4 fake TEST orders (TEST-4 fails on purpose in mock mode); --clean removes them
npm run dev                   # http://localhost:3000
npm test                      # unit tests (voucher mapping, COD, HMAC, phone, status rules)
```

With `GT_MOCK=1` the app fakes GT: **Σύνδεση** accepts any password (except one containing FAIL) and vouchers get numbers like `V-333390xx`.

### Code map

| Path | What |
|---|---|
| `lib/gt/mapVoucher.ts` | **Shopify order → Hermes r18 fields** (the place to adjust field mapping) |
| `lib/gt/client.ts` | Hermes login (username/password → sid, stored encrypted), automatic re-login on 401 |
| `lib/gt/areas.ts` | Postcode → GT service area/zone (make_zonearea) and automatic choice by city |
| `lib/gt/vouchers.ts` | Create / find / cancel / check status |
| `lib/shopify/*` | GraphQL read client, webhook HMAC, sync rules |
| `lib/vouchers.ts` | Issue a voucher for an order (area, duplicate guard, errors) and cancel it |
| `lib/settings.ts` | Settings stored in the DB (GT codes, sender, defaults) |
| `components/OrdersInbox.tsx`, `OrderDrawer.tsx` | The main UI |
| `app/globals.css` | Candly design tokens |

### r18 field mapping (Hermes)

| Hermes | Value |
|---|---|
| `p126` | 2 = send (Settings) |
| `p125` | Shopify order name (`#1051`), also used to prevent duplicates |
| `p04` / `p014` / `p0100` | from Settings (optional) |
| `p120` / `p101` | pieces / weight kg |
| `p0201` | recipient name (+ company) |
| `p0202` / `p0203` / `p0208` | address1 + address2 / city / postcode |
| `p0204country` / `p0204` / `p0205` | country / **service area** (`r07p01`) / **zone** (`r02p01`) from make_zonearea |
| `p0206` / `p0210` / `p0207` | phone (10 digits) / email / courier notes |
| `p022` | cash-on-delivery amount |
| `p0101…p0110`, `p0104/p0105` | sender, only when filled in Settings (otherwise GT uses the account's details) |
