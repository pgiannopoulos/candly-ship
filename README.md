# Candly Ship ✦ Shopify → GT Courier

A small, quiet back-office for **candly.gr**: new Shopify orders arrive automatically, the admin checks the address, creates the **GT Courier voucher** with one click, and prints the **10×15 label** for the package.

- **Reads only** from Shopify (it never changes orders there).
- Talks to GT Courier through their **Pegasus Web App REST API** (docs: https://www.tesae.gr/pegasus-webapp-rest-api).
- Handles **cash on delivery (αντικαταβολή)**: the amount is pre-filled from Shopify and printed on the voucher.
- UI in Greek, in Candly's palette (cream `#fffaf6`, burgundy `#4a1219`, terracotta `#b4532a`, Manrope).

---

## 1. How it works

```
Customer orders on candly.gr
        │  Shopify webhook (orders/create · updated · cancelled)  + backup sync every 10 min
        ▼
Candly Ship  ──  orders inbox  →  "Δημιουργία voucher"  →  POST /api/courier00/r18  (GT / Pegasus)
        │                                          ↓
        └───────────── "Εκτύπωση ετικέτας"  →  POST /api/prints/print  →  PDF → thermal printer
```

Order states in the app:

| State | Meaning |
|---|---|
| **Νέα** | Waiting for a voucher |
| **Σφάλμα** | GT rejected the voucher. The message is shown, so fix the problem and retry |
| **Voucher** | Voucher created at GT, label not printed yet |
| **Εκτυπώθηκε** | Label printed |
| **Ακυρώθηκε** | Cancelled in Shopify before a voucher was made |
| **Παράλειψη** | No shipping needed (pickup, digital, already fulfilled) or skipped by the admin |

---

## 2. Before you start: what to ask GT Courier

The Pegasus API is generic, so **GT has to give us some codes**. You can send them this (in Greek):

> Καλησπέρα σας,
> Συνδέουμε το e-shop μας (candly.gr, Shopify) με το Pegasus Web App σας μέσω του REST API για αυτόματη δημιουργία vouchers. Θα χρειαστούμε:
> 1. **App code (appcode)** για το REST API και ενεργοποίηση δικαιωμάτων για τον χρήστη μας στα: `courier00/r18` (GET/POST/PUT), `courier00/r14` (GET), `prints/print` (POST).
> 2. Το **URL του server** του Pegasus σας (π.χ. `https://….gr`), αν διαφέρει από αυτό που έχουμε.
> 3. Τον **κωδικό πελάτη μας (p02)** και, αν απαιτείται, τον **κωδικό CRM αποστολέα (p0100)** και **υποκατάστημα (p02_1)**.
> 4. Τον **κωδικό είδους εργασίας (p04)** για κανονική αποστολή δέματος, την **αρχική κατάσταση (p014)** και την τιμή του **p126** για «Αποστολή».
> 5. Μπορούμε να στέλνουμε τα στοιχεία παραλήπτη inline (p0201–p0210) χωρίς εγγραφή CRM (p0200);
> 6. Για εκτύπωση: τον **Πίνακα Δεδομένων (tbl)** των vouchers και τη **φόρμα εκτύπωσης (p85) για θερμική ετικέτα 10×15**.
> 7. Πώς **ακυρώνεται** ένα voucher μέσω API (ποιος κωδικός κατάστασης) και το **URL εντοπισμού αποστολής** για τους πελάτες.
>
> Ευχαριστούμε!

All of these go into **Ρυθμίσεις** (Settings) in the app. No code changes are needed.

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

### 3.2 Server (VPS + Docker)

Any small Linux VPS works (1 vCPU / 1–2 GB RAM is plenty, e.g. Hetzner or DigitalOcean).

```bash
# 1. DNS: create an A record  ship.candly.gr → <server IP>
# 2. On the server:
curl -fsSL https://get.docker.com | sh
git clone <this repo> candly-ship && cd candly-ship
cp .env.example .env

# 3. Generate secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → APP_SECRET
npm i bcryptjs && npm run hash-password -- "a-strong-password"           # → ADMIN_PASSWORD_HASH
#    (or run hash-password on your PC and paste the result)

# 4. Fill .env: APP_URL=https://ship.candly.gr, POSTGRES_PASSWORD, Shopify vars,
#    GT_API_HOST, GT_APPCODE, GT_MOCK=0
nano .env

# 5. Start (database + app + HTTPS)
docker compose --profile prod up -d --build
docker compose logs -f app        # look for "webhooks: ORDERS_CREATE: created …"
```

If you use a subdomain other than `ship.candly.gr`, edit `Caddyfile`. Caddy gets the HTTPS certificate automatically.

**Updating:** `git pull && docker compose --profile prod up -d --build`
**Backup:** `docker compose exec db pg_dump -U candly candly_ship > backup.sql`

### 3.3 First login

1. Open **https://ship.candly.gr** and log in with the admin password.
2. Go to **Ρυθμίσεις → Σύνδεση με GT Courier**. You'll be sent to GT's Pegasus login page; sign in with your Pegasus account and you'll be redirected back with "Συνδεδεμένο ✓". The app renews the session by itself after that. If GT ever revokes it, the dot in the header turns red and you click **Επανασύνδεση**.
3. Fill in the **GT codes** from section 2, the **sender details** (Candly's address and phone), and the **defaults** (pieces, weight). Click **Αποθήκευση**.
4. Click **Συγχρονισμός τώρα**. This loads orders from the last 14 days.
5. **Verify the mapping once:** create one voucher by hand in GT's Pegasus, then open **Ρυθμίσεις → Διάγνωση GT**. It shows the real voucher fields (p02, p04, p014…), so you can confirm the codes match what GT gave you.
6. **Test voucher:** create a voucher for one real order. Check it in GT's Pegasus, print it, scan the barcode, then cancel it with GT if it was only a test.

### 3.4 Thermal printer (10×15)

- Install the printer driver (Zebra, Brother QL/TD, Xprinter…) and create a paper size of **100 × 150 mm**.
- The first time you print from the app, set the browser print dialog to that printer, paper **100×150 mm**, **Margins: None**, **Scale: 100% / Actual size**. Chrome and Edge remember these settings.
- If the label comes out A4-sized or blank, ask GT for a 10×15 print form (`p85`) and enter it in Settings.

---

## 4. Daily use

1. **Open the app.** New orders appear in **Νέες** automatically; the list refreshes every 20 seconds, with a "✦ 1 νέα παραγγελία" notice.
2. **Click an order** to open it on the right:
   - Check the **address and phone**. If something is wrong (a typo, missing floor), click **Διόρθωση**. The fix only applies to the voucher, not Shopify.
   - **Pieces / weight**: pre-filled (the weight comes from the Shopify product weights).
   - **Αντ/λή (€)**: pre-filled for COD orders and shown with a terracotta badge. Leave it at 0 for prepaid orders.
   - Optionally add **notes for the courier**.
   - Click **Δημιουργία voucher**, and the voucher number appears in green.
3. **Click Εκτύπωση ετικέτας**, choose the thermal printer, and stick the label on the package.
4. **For many orders at once:** tick them in the list and use **Δημιουργία vouchers (n)**, then **Εκτύπωση ετικετών (n)**. All the labels print as one job.
5. **In Shopify**, mark the order as fulfilled and paste the voucher number as tracking if you want the customer emailed. The app never touches Shopify.

**Keyboard shortcuts:** `j`/`k` move · `x` select · `Enter` open · `v` create voucher · `p` print · `/` search · `Esc` close.

**If something goes wrong:**

| You see | Do |
|---|---|
| Red **Σφάλμα** with GT's message | Open the order, fix the field (usually the postcode or phone), then **Δημιουργία voucher** again |
| "Λείπει τηλέφωνο / Μη έγκυρος ΤΚ" | Use **Διόρθωση** to fill it in |
| Red dot next to *GT Courier* in the header | Go to **Ρυθμίσεις → Επανασύνδεση** |
| An order is missing | Click **↻** (sync) in the list |
| A customer cancelled after the voucher was made | The order shows a warning. Click **Ακύρωση** in the order and cancel it with GT as well, unless the cancel code is configured, in which case the app cancels it at GT |
| A store-pickup order | It's skipped automatically. You can also use **Παράλειψη** |

Creating a voucher twice is safe: if GT already has a voucher for that order number, the app reuses it instead of creating a duplicate.

---

## 5. Development

```bash
npm install
cp .env.example .env          # set GT_MOCK=1 to work without GT
npm run db:up                 # Postgres in Docker on localhost:5432
npm run db:push               # create tables
npm run seed:demo             # 5 demo orders (#1055 fails on purpose)
npm run dev                   # http://localhost:3000
npm test                      # unit tests (voucher mapping, COD, HMAC, phone, status rules)
```

With `GT_MOCK=1` the app fakes GT: **Σύνδεση** connects instantly, vouchers get numbers like `GT2026000090xx`, and labels are sample 10×15 PDFs.

### Code map

| Path | What |
|---|---|
| `lib/gt/mapVoucher.ts` | **Shopify order → Pegasus r18 fields** (the place to adjust field mapping) |
| `lib/gt/client.ts` | Pegasus auth (initiate → login → token), auto-refresh on 419 |
| `lib/gt/vouchers.ts` | Create / find / print / merge PDFs |
| `lib/shopify/*` | GraphQL read client, webhook HMAC, sync rules |
| `lib/vouchers.ts` | Create voucher for an order (duplicate guard, errors, labels) |
| `lib/settings.ts` | Settings stored in the DB (GT codes, sender, defaults) |
| `components/OrdersInbox.tsx`, `OrderDrawer.tsx` | The main UI |
| `app/globals.css` | Candly design tokens |

### r18 field mapping (Pegasus)

| Pegasus | Value |
|---|---|
| `p015` | today (Y-m-d) |
| `p125` | Shopify order name (`#1051`) |
| `p02` / `p0100` / `p02_1` / `p04` / `p014` / `p126` | from Settings (GT codes) |
| `p120` / `p101` / `p124` | pieces / weight kg / 2 = parcel |
| `p0101…p0110` | sender (Settings) |
| `p03`, `p0201` | recipient name (60) |
| `p0202` | address1 + address2 (100) |
| `p0203` | city (40) |
| `p0208_1`, `p0208` | postcode |
| `p0206` | phone, normalised to 10 digits |
| `p0210` | email |
| `p0207`, `p018` | courier notes |
| `pdc03` | items ("2× Melomakarono Candle") |
| `pdl02` | send SMS to the recipient |
| `p026`, `p022`, `p021` | COD flag, cash amount, COD note |
