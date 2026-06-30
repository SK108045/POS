# BuildMart POS

A lightweight retail/hardware POS system built for small shops that just need something that works — no bloated dependencies, no cloud subscription, no nonsense. Runs as a single Python process with a vanilla JS frontend, backed by SQLite. Point it at a till, plug in a barcode scanner, and you're selling.

I built this to handle real day-to-day shop operations: inventory tracking, supplier purchases, sales, and reporting, all from one terminal (or a few on the same LAN).

## What it does

- Runs as a single Python server — no external packages to install
- SQLite database (WAL mode) so it's fast and doesn't choke under concurrent writes
- Clean, touch-friendly UI that works well on a small POS screen or tablet
- Full inventory + supplier + purchase order tracking
- Cashier and admin roles, with PIN login for quick staff access
- Product image uploads baked in

## Getting it running

Clone it:
```bash
git clone https://github.com/SK108045/POS.git
cd POS
```

Run it:
```bash
python app.py
```

That spins it up on `127.0.0.1:3000` by default. Want a different port?
```bash
POS_PORT=8080 python app.py
```

Then just open `http://127.0.0.1:3000` in a browser and you're in.

## Logging in

- **Staff/cashier:** PIN `1234`
- **Admin:** `admin` / `admin123`

Change both of these before you actually use it for a real shop — they're just there to get you started.

## Project layout

```
app.py        — the whole backend: server, routes, DB setup, templates
static/       — frontend assets
  ├── app.js       — POS logic
  ├── admin.js     — admin dashboard logic
  └── styles.css, admin.css
data/         — SQLite DB lives here (pos.sqlite3)
start-pos.bat — quick-start script for Windows
```

## How it's wired together

`app.py` runs a threaded HTTP server handling everything:
- Static files under `/static/*`
- Pages like `/pos`, `/cashier`, `/admin`, `/suppliers`, `/reports`
- A JSON API under `/api/*` that the frontend talks to for orders, payments, and admin actions

The frontend boots up by hitting `/api/bootstrap`, then it's all API calls from there for creating orders, adding line items, and processing payments.
