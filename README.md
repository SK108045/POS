# BuildMart — Lightweight Retail POS

BuildMart is a compact, single-machine retail/hardware POS implemented in a single Python process with a vanilla JavaScript front end. It targets small shops and single-terminal / LAN deployments that need a minimal, dependency-free POS with inventory, suppliers, orders, and simple reporting.

## Highlights

- Single-file Python server (no external Python packages required)
- SQLite (WAL) local database stored in `data/pos.sqlite3`
- Touch-friendly front-end UI (vanilla JS + CSS)
- Inventory, suppliers, purchases, sales, basic reports, and cashier/admin roles
- Image upload support for product images (saved to `static/uploads`)

## Quick start (local)

1. Clone the repo:
   ```bash
   git clone https://github.com/SK108045/POS.git
   cd POS
   ```

2. Run with Python 3:
   ```bash
   # default: runs on 127.0.0.1:3000
   python app.py

   # to change the HTTP port:
   POS_PORT=8080 python app.py
   ```

3. Open the app in your browser:
   - http://127.0.0.1:3000 (or the port you set)

## Default credentials

- **Terminal (staff PIN):** `1234`
  - username: `terminal` (used for quick staff login via PIN)
- **Admin (manager):** `admin` / `admin123`
  - Use the Admin portal to manage users, products, suppliers, and stock.

## Notes and recommendations

**Data and backups**
- The SQLite database file is in `data/pos.sqlite3` and uses WAL mode. Back up the `data/` directory regularly.
- Do not place the data file on an unreliable filesystem without backups.

**Security**
- This app is intended for local or LAN use. If you must expose it to the internet, add TLS, a proper reverse proxy, strong credentials, and restrict access by IP.
- Change the default admin password immediately after first run.

**Port and binding**
- By default the server binds to `127.0.0.1` and listens on port `3000`. To change the port, set the environment variable `POS_PORT` before starting the app.

**Windows helper**
- `start-pos.bat` shows an example of starting from `D:\POS`. Edit the script or run `python app.py` from your working directory instead.

## File layout (important files)

```
app.py        — Main Python HTTP server, DB initialization, API routes, and HTML templates
static/       — Front-end JS, CSS, and runtime uploads
  ├── app.js       — POS frontend logic
  ├── admin.js     — Admin UI logic
  └── styles.css, admin.css
data/         — SQLite database (pos.sqlite3) and WAL files
start-pos.bat — Example Windows batch to run the server
```

## How it works (brief)

- `app.py` runs a `ThreadingHTTPServer` that serves:
  - Static assets under `/static/*`
  - HTML pages: `/pos`, `/cashier`, `/admin`, `/suppliers`, `/reports`, etc.
  - JSON API under `/api/*` for bootstrap/menu/orders/payments/admin actions.
- The front-end (`static/app.js`) boots with `/api/bootstrap`, then runs the POS UI and issues API requests to create orders, add items, and mark payments.

## Extending or customizing

- To change store branding: edit `STORE_NAME` and `STORE_TAGLINE` in `app.py`.
- To seed or modify initial data: look in `init_db()` inside `app.py`.
- To add TLS or production-grade deployment: run behind a reverse proxy (nginx) with TLS and bind the app to localhost only, or containerize it 
