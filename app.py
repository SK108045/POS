from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import hashlib
import json
import secrets
import sqlite3
import time


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "pos.sqlite3"
STATIC_DIR = BASE_DIR / "static"
HOST = "127.0.0.1"
PORT = int(__import__("os").environ.get("POS_PORT", "3000"))

SESSIONS = {}
CACHE = {"menu": None, "menu_ts": 0}
STORE_NAME = "BuildMart"
STORE_TAGLINE = "Hardware & Retail POS"


def now():
    return int(time.time())


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120000).hex()
    return f"{salt}${digest}"


def check_password(password, stored):
    salt, digest = stored.split("$", 1)
    return hash_password(password, salt).split("$", 1)[1] == digest


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def rows(cursor):
    return [dict(row) for row in cursor.fetchall()]


def init_db():
    DATA_DIR.mkdir(exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'cashier',
                password_hash TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS menu_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER NOT NULL REFERENCES categories(id),
                name TEXT NOT NULL,
                price_cents INTEGER NOT NULL,
                color TEXT NOT NULL DEFAULT '#334155',
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS suppliers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                phone TEXT,
                email TEXT,
                address TEXT,
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_no TEXT UNIQUE NOT NULL,
                supplier_id INTEGER REFERENCES suppliers(id),
                order_type TEXT NOT NULL DEFAULT 'walk-in',
                customer_name TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                subtotal_cents INTEGER NOT NULL DEFAULT 0,
                tax_cents INTEGER NOT NULL DEFAULT 0,
                total_cents INTEGER NOT NULL DEFAULT 0,
                paid_cents INTEGER NOT NULL DEFAULT 0,
                payment_method TEXT,
                payment_ref TEXT,
                created_by INTEGER REFERENCES users(id),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                menu_item_id INTEGER REFERENCES menu_items(id),
                name TEXT NOT NULL,
                qty INTEGER NOT NULL DEFAULT 1,
                unit_price_cents INTEGER NOT NULL,
                line_total_cents INTEGER NOT NULL,
                note TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS stock_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL REFERENCES menu_items(id),
                qty_change INTEGER NOT NULL,
                reason TEXT NOT NULL DEFAULT 'sale',
                note TEXT,
                created_by INTEGER REFERENCES users(id),
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS stock_purchases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
                product_id INTEGER NOT NULL REFERENCES menu_items(id),
                qty_received INTEGER NOT NULL,
                cost_per_unit_cents INTEGER NOT NULL,
                total_cost_cents INTEGER NOT NULL,
                date_received INTEGER NOT NULL,
                created_by INTEGER REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, updated_at);
            CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
            CREATE INDEX IF NOT EXISTS idx_menu_items_active ON menu_items(active, category_id);
            """
        )
        # Migrate existing menu_items table — add retail columns if missing
        mi_cols = {row["name"] for row in conn.execute("PRAGMA table_info(menu_items)")}
        migrations = [
            ("sku", "ALTER TABLE menu_items ADD COLUMN sku TEXT"),
            ("barcode", "ALTER TABLE menu_items ADD COLUMN barcode TEXT"),
            ("stock_qty", "ALTER TABLE menu_items ADD COLUMN stock_qty INTEGER NOT NULL DEFAULT 0"),
            ("cost_cents", "ALTER TABLE menu_items ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0"),
            ("unit", "ALTER TABLE menu_items ADD COLUMN unit TEXT NOT NULL DEFAULT 'pcs'"),
            ("supplier_id", "ALTER TABLE menu_items ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)"),
            ("image_url", "ALTER TABLE menu_items ADD COLUMN image_url TEXT"),
        ]
        for col, sql in migrations:
            if col not in mi_cols:
                conn.execute(sql)
                
        import os
        os.makedirs("static/uploads", exist_ok=True)
        # Migrate orders table
        o_cols = {row["name"] for row in conn.execute("PRAGMA table_info(orders)")}
        if "customer_name" not in o_cols:
            conn.execute("ALTER TABLE orders ADD COLUMN customer_name TEXT NOT NULL DEFAULT ''")
        if "supplier_id" not in o_cols:
            conn.execute("ALTER TABLE orders ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)")
        if "payment_ref" not in o_cols:
            conn.execute("ALTER TABLE orders ADD COLUMN payment_ref TEXT")
            
        cost_updates = {
            "EL-001": 5500, "EL-002": 22000, "EL-003": 48000, "EL-004": 18000,
            "PL-001": 31000, "PL-002": 14000, "PL-003": 20000,
            "PA-001": 160000, "PA-002": 100000, "PA-003": 9000,
            "FA-001": 12000, "FA-002": 14000, "FA-003": 2800,
            "TO-001": 32000, "TO-002": 52000, "TO-003": 75000,
            "SA-001": 40000, "SA-002": 16000,
            "BM-001": 78000, "BM-002": 7000,
        }
        for sku, cost in cost_updates.items():
            conn.execute("UPDATE menu_items SET cost_cents = ? WHERE sku = ? AND cost_cents = 0", (cost, sku))
            
        # Migrate legacy dining_tables if it exists — we keep it for compat but don't use it
        conn.execute("CREATE TABLE IF NOT EXISTS dining_tables (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, seats INTEGER NOT NULL DEFAULT 4, active INTEGER NOT NULL DEFAULT 1)")
        conn.execute('''
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                email TEXT,
                notes TEXT,
                created_at INTEGER DEFAULT (cast(strftime('%s','now') as int))
            )
        ''')

        if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            conn.execute(
                "INSERT INTO users(username, full_name, role, password_hash) VALUES (?, ?, ?, ?)",
                ("terminal", "POS Terminal", "terminal", hash_password("1234")),
            )
            conn.execute(
                "INSERT INTO users(username, full_name, role, password_hash) VALUES (?, ?, ?, ?)",
                ("admin", "The Owner", "manager", hash_password("admin123")),
            )
        else:
            terminal = conn.execute("SELECT id FROM users WHERE username = 'terminal'").fetchone()
            if not terminal:
                conn.execute(
                    "INSERT INTO users(username, full_name, role, password_hash) VALUES (?, ?, ?, ?)",
                    ("terminal", "POS Terminal", "terminal", hash_password("1234")),
                )
            conn.execute("UPDATE users SET active = 1, role = 'terminal' WHERE username = 'terminal'")

            admin = conn.execute("SELECT id, password_hash FROM users WHERE username = 'admin'").fetchone()
            if not admin:
                conn.execute(
                    "INSERT INTO users(username, full_name, role, password_hash) VALUES (?, ?, ?, ?)",
                    ("admin", "The Owner", "manager", hash_password("admin123")),
                )
            else:
                conn.execute(
                    "UPDATE users SET full_name = 'The Owner', role = 'manager' WHERE id = ?",
                    (admin["id"],),
                )
            
            # Clean up old dummy staff
            conn.execute("DELETE FROM users WHERE username != 'terminal' AND username != 'admin'")

        if conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0:
            seed_categories = ["Electrical", "Plumbing", "Paint & Finishes", "Fasteners", "Tools", "Safety", "Building Materials"]
            for i, name in enumerate(seed_categories):
                conn.execute("INSERT INTO categories(name, sort_order) VALUES (?, ?)", (name, i))

            cat_ids = {r["name"]: r["id"] for r in conn.execute("SELECT id, name FROM categories")}
            seed_items = [
                ("Electrical", "2.5mm Cable (per m)", 85,  55,  "#b45309", "EL-001", 50, "m"),
                ("Electrical", "13A Socket",          350, 220,  "#92400e", "EL-002", 30, "pcs"),
                ("Electrical", "MCB Breaker 20A",     650, 480,  "#78350f", "EL-003", 15, "pcs"),
                ("Electrical", "LED Bulb 18W",        280, 180,  "#d97706", "EL-004", 40, "pcs"),
                ("Plumbing",   "½\" Gate Valve",      480, 310,  "#0369a1", "PL-001", 20, "pcs"),
                ("Plumbing",   "½\" PVC Pipe (3m)",   220, 140,  "#0284c7", "PL-002", 35, "pcs"),
                ("Plumbing",   "P-Trap Set",          320, 200,  "#0891b2", "PL-003", 12, "pcs"),
                ("Paint & Finishes", "Dulux White 4L",2200,1600,  "#6d28d9", "PA-001",  8, "tin"),
                ("Paint & Finishes", "Primer 4L",    1400,1000,  "#7c3aed", "PA-002", 10, "tin"),
                ("Paint & Finishes", "Paint Brush 4\"",180, 90,  "#8b5cf6", "PA-003", 25, "pcs"),
                ("Fasteners",  "3\" Wire Nail (kg)",  180, 120,  "#15803d", "FA-001", 50, "kg"),
                ("Fasteners",  "Wood Screw 2\" (box)",220, 140,  "#166534", "FA-002", 40, "box"),
                ("Fasteners",  "Masonry Bolt M8",      45,  28,  "#14532d", "FA-003",100, "pcs"),
                ("Tools",      "Tape Measure 5m",     550, 320,  "#be185d", "TO-001", 15, "pcs"),
                ("Tools",      "Hammer 500g",         850, 520,  "#9d174d", "TO-002", 10, "pcs"),
                ("Tools",      "Hand Saw",           1200, 750,  "#831843", "TO-003",  8, "pcs"),
                ("Safety",     "Safety Helmet",       650, 400,  "#dc2626", "SA-001", 12, "pcs"),
                ("Safety",     "Work Gloves (pair)",  280, 160,  "#b91c1c", "SA-002", 30, "pair"),
                ("Building Materials","Portland Cement 50kg",1050,780,"#475569","BM-001",20,"bag"),
                ("Building Materials","River Sand (debe)",   120, 70, "#64748b","BM-002", 0,"debe"),
            ]
            for category, name, price, cost, color, sku, stock, unit in seed_items:
                conn.execute(
                    "INSERT INTO menu_items(category_id, name, price_cents, cost_cents, color, sku, stock_qty, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (cat_ids[category], name, price * 100, cost * 100, color, sku, stock, unit),
                )

        if conn.execute("SELECT COUNT(*) FROM suppliers").fetchone()[0] == 0:
            seed_suppliers = [
                ("Crown Paints Kenya", "+254 700 111 000", "orders@crownpaints.co.ke"),
                ("Bidco Hardware", "+254 722 222 111", "supply@bidco.co.ke"),
                ("Kenya Electricity Supply", "+254 711 333 000", "procurement@kesco.co.ke"),
                ("East Africa Cables", "+254 733 444 000", "sales@eacables.co.ke"),
            ]
            for name, phone, email in seed_suppliers:
                conn.execute("INSERT INTO suppliers(name, phone, email) VALUES (?, ?, ?)", (name, phone, email))


def money(cents):
    return f"{cents / 100:.2f}"


def recalc_order(conn, order_id):
    subtotal = conn.execute(
        "SELECT COALESCE(SUM(line_total_cents), 0) FROM order_items WHERE order_id = ?",
        (order_id,),
    ).fetchone()[0]
    tax = round(subtotal * 0.0)
    total = subtotal + tax
    conn.execute(
        "UPDATE orders SET subtotal_cents = ?, tax_cents = ?, total_cents = ?, updated_at = ? WHERE id = ?",
        (subtotal, tax, total, now(), order_id),
    )


def next_ticket(conn):
    return f"R{now()}{conn.execute('SELECT COUNT(*) FROM orders').fetchone()[0] + 1:03d}"


def get_order_payload(conn, order_id):
    order = conn.execute(
        """
        SELECT o.*, u.full_name AS employee_name, u.username AS employee_username
        FROM orders o
        LEFT JOIN users u ON u.id = o.created_by
        WHERE o.id = ?
        """,
        (order_id,),
    ).fetchone()
    if not order:
        return None
    items = rows(conn.execute("SELECT * FROM order_items WHERE order_id = ? ORDER BY id", (order_id,)))
    payload = dict(order)
    payload["items"] = items
    payload["total"] = money(payload["total_cents"])
    return payload


def receipt_page(order, autoprint=False):
    item_rows = "".join(
        f"""
        <tr>
          <td>{item['qty']} x {item['name']}</td>
          <td>{money(item['line_total_cents'])}</td>
        </tr>
        """
        for item in order["items"]
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Receipt {order['ticket_no']} — {STORE_NAME}</title>
  <link rel="stylesheet" href="/static/styles.css?v=1782814339.4704366">
</head>
<body class="receipt-body">
  <section class="receipt">
    <h1>{STORE_NAME}</h1>
    <p>{STORE_TAGLINE}</p>
    <div class="receipt-line"><span>Receipt #</span><strong>{order['ticket_no']}</strong></div>
    <div class="receipt-line"><span>Type</span><strong>{order['order_type']}</strong></div>
    <div class="receipt-line"><span>Served By</span><strong>{order.get('employee_name') or '-'}</strong></div>
    <div class="receipt-line"><span>Status</span><strong>{order['status']}</strong></div>
    <table>
      <tbody>{item_rows}</tbody>
    </table>
    <div class="receipt-total"><span>Total</span><strong>KES {order['total']}</strong></div>
    <p class="receipt-note">Thank you for shopping at {STORE_NAME}!</p>
    <button onclick="window.print()">Print Receipt</button>
  </section>
  {"<script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script>" if autoprint else ""}
</body>
</html>"""


def hidden_admin_page():
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Portal — BuildMart</title>
  <link rel="stylesheet" href="/static/admin.css">
</head>
<body>
  <div class="admin-shell">
    <!-- SIDEBAR -->
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="logo">
          <div class="logo-icon">B</div>
          <span class="name">BuildMart</span>
        </div>
        <div class="tag">Admin Portal</div>
        <button class="sidebar-toggle" id="sidebarToggle" title="Toggle sidebar">
          <span></span><span></span><span></span>
        </button>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-item active" data-section="dashboard">
          <span class="nav-icon">&#9646;</span>
          <span class="nav-label">Dashboard</span>
        </div>
        <div class="nav-item" data-section="users">
          <span class="nav-icon">&#9646;</span>
          <span class="nav-label">Staff</span>
        </div>
        <div class="nav-item" data-section="menu">
          <span class="nav-icon">&#9646;</span>
          <span class="nav-label">Products</span>
        </div>
        <div class="nav-item" data-section="customers">
          <span class="nav-icon">&#9646;</span>
          <span class="nav-label">Customers</span>
        </div>
        <div class="nav-item" data-section="pos">
          <span class="nav-icon">&#9646;</span>
          <span class="nav-label">Back to POS</span>
        </div>
      </nav>
      <div class="sidebar-footer">
        <div class="user-card">
          <div class="user-avatar" id="userAvatarLetter">A</div>
          <div class="user-info">
            <div class="user-name" id="userDisplayName">Admin</div>
            <div class="user-role">Manager</div>
          </div>
        </div>
        <a class="logout-btn" href="/logout">Logout</a>
      </div>
    </aside>

    <!-- MAIN -->
    <main class="main-content">
      <div class="content-section active" id="sec-dashboard"></div>
      <div class="content-section" id="sec-users"></div>
      <div class="content-section" id="sec-menu"></div>
      <div class="content-section" id="sec-customers"></div>
    </main>
  </div>

  <!-- FLOATING OPEN BUTTON (shown when sidebar is collapsed) -->
  <button class="sidebar-open-btn" id="sidebarOpenBtn" title="Open sidebar">
    <span></span><span></span><span></span>
  </button>

  <!-- TOAST CONTAINER -->
  <div class="toast-container" id="toastContainer"></div>

  <script src="/static/admin.js" defer></script>
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      const shell = document.querySelector('.admin-shell');
      const closeBtn = document.getElementById('sidebarToggle');
      const openBtn = document.getElementById('sidebarOpenBtn');
      closeBtn.addEventListener('click', () => shell.classList.add('collapsed'));
      openBtn.addEventListener('click', () => shell.classList.remove('collapsed'));
    });
  </script>
</body>
</html>"""


def page(title, active, content, role=None):
    nav = [
        ("POS", "/pos"),
        ("Suppliers", "/suppliers"),
        ("Sales", "/sales"),
        ("Products", "/products"),
        ("Reports", "/reports"),
    ]
    links = "".join(
        f'<a class="nav-link {"active" if active == label else ""}" href="{href}">{label}</a>'
        for label, href in nav
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} — {STORE_NAME} Retail POS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/styles.css?v=1782814339.4704366">
</head>
<body>
  <header class="topbar">
    <div class="topbar-left">
      <a class="brand" href="/pos">
        <div class="brand-logo">B</div>
        <div class="brand-text">
          <span>{STORE_NAME}</span>
          <small>{STORE_TAGLINE}</small>
        </div>
      </a>
    </div>
    <div class="topbar-center">
      <nav>{links}</nav>
    </div>
    <div class="topbar-right">
      <a class="logout" href="/logout">Logout</a>
    </div>
  </header>
  <main>{content}</main>
  <script src="/static/app.js?v=1782840019.8126402" defer></script>
</body>
</html>"""


def employee_login_page(error=""):
    message = f'<p class="error">{error}</p>' if error else ""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Staff Login — {STORE_NAME} POS</title>
  <link rel="stylesheet" href="/static/styles.css?v=1782814339.4704366">
</head>
<body class="login-body">
  <form class="login-panel" method="post" action="/login">
    <h1>{STORE_NAME} POS</h1>
    <p>Enter your staff PIN</p>
    {message}
    <input id="pinInput" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" value="" autocomplete="current-password" autofocus>
    <div class="pin-pad" data-pin-pad>
      <button type="button" data-key="1">1</button>
      <button type="button" data-key="2">2</button>
      <button type="button" data-key="3">3</button>
      <button type="button" data-key="4">4</button>
      <button type="button" data-key="5">5</button>
      <button type="button" data-key="6">6</button>
      <button type="button" data-key="7">7</button>
      <button type="button" data-key="8">8</button>
      <button type="button" data-key="9">9</button>
      <button type="button" data-key="clear">Clear</button>
      <button type="button" data-key="0">0</button>
      <button type="submit">Enter</button>
    </div>
    <small>POS default PIN: 1234</small>
  </form>
  <script>
    const pinInput = document.getElementById('pinInput');
    document.querySelectorAll('[data-pin-pad] button[data-key]').forEach((button) => {{
      button.addEventListener('click', () => {{
        const key = button.dataset.key;
        if (key === 'clear') pinInput.value = '';
        else if (pinInput.value.length < 6) pinInput.value += key;
        pinInput.focus();
      }});
    }});
  </script>
</body>
</html>"""


def cashier_login_page(error=""):
    message = f'<p class="error">{error}</p>' if error else ""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cashier Login — {STORE_NAME} POS</title>
  <link rel="stylesheet" href="/static/styles.css?v=1782814339.4704366">
</head>
<body class="login-body">
  <form class="login-panel" method="post" action="/cashier">
    <h1>Cashier Portal</h1>
    <p>Username and password required</p>
    {message}
    <label>Username<input name="username" autocomplete="username" autofocus></label>
    <label>Password<input name="password" type="password" autocomplete="current-password"></label>
    <button type="submit">Log In</button>
    <small>Default: admin / admin123</small>
  </form>
</body>
</html>"""


def admin_login_page(error=""):
    message = f'<p class="error">{error}</p>' if error else ""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Login — {STORE_NAME}</title>
  <link rel="stylesheet" href="/static/admin.css">
  <style>
    body {{ display:grid; place-items:center; min-height:100vh; background:var(--bg); }}
    .admin-login-panel {{
      width: min(380px, calc(100vw - 32px));
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow-lg);
      padding: 36px;
      display: grid;
      gap: 18px;
    }}
    .admin-login-panel .brand {{
      display:flex; align-items:center; gap:10px; margin-bottom:4px;
    }}
    .admin-login-panel .logo-icon {{
      width:38px; height:38px; background:var(--primary);
      border-radius:9px; display:grid; place-items:center;
      font-size:18px; font-weight:900; color:#fff;
    }}
    .admin-login-panel h2 {{ margin:0; font-size:20px; font-weight:800; color:var(--navy); }}
    .admin-login-panel p {{ margin:0; color:var(--muted); font-size:13px; }}
    .admin-login-panel .err {{ color:var(--danger); font-weight:700; font-size:13px; }}
  </style>
</head>
<body>
  <form class="admin-login-panel" method="post" action="/admin">
    <div class="brand">
      <div class="logo-icon">B</div>
      <div>
        <h2>{STORE_NAME} Admin</h2>
        <p>Restricted access</p>
      </div>
    </div>
    {message}
    <div class="form-group">
      <label class="form-label">Username</label>
      <input class="form-input" name="username" autocomplete="username" autofocus placeholder="admin">
    </div>
    <div class="form-group">
      <label class="form-label">Password</label>
      <input class="form-input" name="password" type="password" autocomplete="current-password" placeholder="••••••••">
    </div>
    <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center;padding:12px">Sign In</button>
  </form>
</body>
</html>"""


class POSHandler(SimpleHTTPRequestHandler):
    server_version = "BuildMartPOS/1.0"

    def log_message(self, format, *args):
        return

    def send_html(self, html, status=200):
        data = html.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload, status=200):
        data = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        content_type = self.headers.get("Content-Type", "")
        if "application/json" in content_type:
            return json.loads(raw or b"{}")
        return {k: v[0] for k, v in parse_qs(raw.decode()).items()}

    def session_user(self):
        header = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie(header)
        sid = jar.get("sid")
        return SESSIONS.get(sid.value) if sid else None

    def require_user(self):
        user = self.session_user()
        if user:
            return user
        if self.path.startswith("/api/"):
            self.send_json({"error": "login_required"}, 401)
        else:
            self.send_response(302)
            self.send_header("Location", "/login")
            self.end_headers()
        return None

    def require_cashier(self, user):
        if user.get("role") in ("manager", "cashier"):
            return True
        if self.path.startswith("/api/"):
            self.send_json({"error": "cashier_login_required"}, 403)
        else:
            self.send_html(page("Cashier Required", "", '<section class="empty">Cashier login required for this page</section>'), 403)
        return False

    def require_manager(self, user):
        if user.get("role") == "manager":
            return True
        if self.path.startswith("/api/"):
            self.send_json({"error": "manager_login_required"}, 403)
        else:
            self.send_html(page("Admin Required", "", '<section class="empty">Admin manager login required for this page</section>'), 403)
        return False

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/static/"):
            self.directory = str(BASE_DIR)
            return super().do_GET()
        if path in ("/", "/login"):
            if self.session_user():
                self.send_response(302)
                self.send_header("Location", "/pos")
                self.end_headers()
            else:
                self.send_html(employee_login_page())
            return
        if path == "/cashier":
            user = self.session_user()
            if user and user.get("role") in ("manager", "cashier"):
                # Authenticated cashier — show the payments page directly
                self.send_html(page("Cashier", "Cashier", '<section class="page-shell" data-page="cashier"></section>', user.get("role")))
            else:
                self.send_html(cashier_login_page())
            return
        if path == "/logout":
            sid = cookies.SimpleCookie(self.headers.get("Cookie", "")).get("sid")
            if sid:
                SESSIONS.pop(sid.value, None)
            self.send_response(302)
            self.send_header("Set-Cookie", "sid=; Max-Age=0; Path=/")
            self.send_header("Location", "/login")
            self.end_headers()
            return

        if path == "/secret-admin":
            user = self.session_user()
            if not user:
                self.send_html(admin_login_page())
                return
            if user.get("role") != "manager":
                self.send_html(admin_login_page("Access denied: manager account required"), 403)
                return
            self.send_html(hidden_admin_page())
            return

        if path == "/admin":
            user = self.session_user()
            if not user:
                self.send_html(admin_login_page())
                return
            if user.get("role") != "manager":
                self.send_html(admin_login_page("Access denied: manager account required"), 403)
                return
            self.send_html(hidden_admin_page())
            return

        user = self.require_user()
        if not user:
            return

        if path.startswith("/api/"):
            return self.api_get(path, parse_qs(parsed.query), user)

        if path == "/receipt":
            order_id = parse_qs(parsed.query).get("order_id", [""])[0]
            if not order_id.isdigit():
                self.send_html(page("Receipt", "", '<section class="empty">Missing order id</section>'), 400)
                return
            with db() as conn:
                order = get_order_payload(conn, int(order_id))
            if not order:
                self.send_html(page("Receipt", "", '<section class="empty">Order not found</section>'), 404)
                return
            autoprint = parse_qs(parsed.query).get("print", ["0"])[0] == "1"
            self.send_html(receipt_page(order, autoprint))
            return

        pages = {
            "/pos": ("POS", "POS", '<section class="pos-shell" data-page="pos"></section>'),
            "/suppliers": ("Suppliers", "Suppliers", '<section class="page-shell" data-page="suppliers"></section>'),
            "/sales": ("Sales", "Sales", '<section class="page-shell" data-page="sales"></section>'),
            "/products": ("Products", "Products", '<section class="page-shell" data-page="products"></section>'),
            "/customers": ("Customers", "Customers", '<section class="page-shell" data-page="customers"></section>'),
            "/reports": ("Reports", "Reports", '<section class="page-shell" data-page="reports"></section>'),
        }
        if path in pages:
            title, active, content = pages[path]
            self.send_html(page(title, active, content, user.get("role")))
            return
        self.send_html(page("Not Found", "", '<section class="empty">Page not found</section>'), 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        method = self.command
        if path == "/login":
            data = self.read_body()
            pin = data.get("pin", "")
            user = None
            with db() as conn:
                user = conn.execute("SELECT * FROM users WHERE username = 'terminal' AND active = 1").fetchone()
            if user and not check_password(pin, user["password_hash"]):
                user = None
            if user:
                sid = secrets.token_urlsafe(32)
                SESSIONS[sid] = {"id": user["id"], "username": user["username"], "role": user["role"], "name": user["full_name"]}
                self.send_response(302)
                self.send_header("Set-Cookie", f"sid={sid}; HttpOnly; SameSite=Lax; Path=/")
                self.send_header("Location", "/pos")
                self.end_headers()
            else:
                self.send_html(employee_login_page("Invalid PIN"), 401)
            return
        if path == "/cashier":
            data = self.read_body()
            with db() as conn:
                user = conn.execute(
                    "SELECT * FROM users WHERE username = ? AND role IN ('manager', 'cashier') AND active = 1",
                    (data.get("username", ""),),
                ).fetchone()
            if user and check_password(data.get("password", ""), user["password_hash"]):
                sid = secrets.token_urlsafe(32)
                SESSIONS[sid] = {"id": user["id"], "username": user["username"], "role": user["role"], "name": user["full_name"]}
                self.send_response(302)
                self.send_header("Set-Cookie", f"sid={sid}; HttpOnly; SameSite=Lax; Path=/")
                self.send_header("Location", "/cashier")
                self.end_headers()
            else:
                self.send_html(cashier_login_page("Invalid username or password"), 401)
            return
        if path == "/admin":
            data = self.read_body()
            with db() as conn:
                user = conn.execute(
                    "SELECT * FROM users WHERE username = ? AND role = 'manager' AND active = 1",
                    (data.get("username", ""),),
                ).fetchone()
            if user and check_password(data.get("password", ""), user["password_hash"]):
                sid = secrets.token_urlsafe(32)
                SESSIONS[sid] = {"id": user["id"], "username": user["username"], "role": user["role"], "name": user["full_name"]}
                self.send_response(302)
                self.send_header("Set-Cookie", f"sid={sid}; HttpOnly; SameSite=Lax; Path=/")
                self.send_header("Location", "/admin")
                self.end_headers()
            else:
                self.send_html(admin_login_page("Invalid credentials or insufficient permissions"), 401)
            return

        user = self.require_user()
        if not user:
            return
        if path.startswith("/api/"):
            return self.api_post(path, self.read_body(), user, method, query)
        self.send_json({"error": "not_found"}, 404)

    def api_get(self, path, query, user):
        with db() as conn:
            if path == "/api/bootstrap":
                self.send_json({
                    "user": user,
                    "employees": self.employees_payload(conn),
                    "menu": self.menu_payload(conn),
                    "suppliers": rows(conn.execute("SELECT * FROM suppliers WHERE active = 1 ORDER BY name")),
                })
            elif path == "/api/menu":
                self.send_json(self.menu_payload(conn))
            elif path == "/api/suppliers":
                self.send_json(rows(conn.execute("SELECT * FROM suppliers ORDER BY name")))
            elif path == "/api/supplier/detail":
                supplier_id = int(query.get("id", [0])[0])
                supplier = dict(conn.execute("SELECT * FROM suppliers WHERE id = ?", (supplier_id,)).fetchone())
                products = rows(conn.execute(
                    """
                    SELECT m.name, m.cost_cents, m.stock_qty, MAX(sp.date_received) as last_delivery
                    FROM menu_items m
                    LEFT JOIN stock_purchases sp ON sp.product_id = m.id
                    WHERE m.supplier_id = ? AND m.active = 1
                    GROUP BY m.id
                    """, (supplier_id,)
                ))
                stats = dict(conn.execute(
                    "SELECT COALESCE(SUM(total_cost_cents), 0) as total_purchases FROM stock_purchases WHERE supplier_id = ?",
                    (supplier_id,)
                ).fetchone())
                supplier["products"] = products
                supplier["total_purchases"] = stats["total_purchases"]
                self.send_json(supplier)
            elif path == "/api/stock":
                self.send_json(rows(conn.execute(
                    "SELECT id, name, sku, stock_qty, unit, category_id, price_cents, cost_cents, image_url FROM menu_items WHERE active = 1 ORDER BY stock_qty ASC, name"
                )))
            elif path == "/api/order":
                order_id = query.get("id", [""])[0]
                if not order_id.isdigit():
                    return self.send_json({"error": "invalid_id"}, 400)
                order = get_order_payload(conn, int(order_id))
                if not order:
                    return self.send_json({"error": "not_found"}, 404)
                self.send_json(order)
            elif path == "/api/orders":
                status = query.get("status", ["open"])[0]
                sql = """
                    SELECT o.*, u.full_name AS employee_name
                    FROM orders o
                    LEFT JOIN users u ON u.id = o.created_by
                    WHERE (? = 'all' OR o.status = ?)
                    ORDER BY o.updated_at DESC LIMIT 80
                """
                self.send_json(rows(conn.execute(sql, (status, status))))
            elif path == "/api/payments":
                if not self.require_cashier(user):
                    return
                term = query.get("q", [""])[0].strip()
                like = f"%{term}%"
                self.send_json(rows(conn.execute(
                    """
                    SELECT o.*, u.full_name AS employee_name
                    FROM orders o
                    LEFT JOIN users u ON u.id = o.created_by
                    WHERE o.status IN ('open', 'sent')
                    AND (? = '' OR o.ticket_no LIKE ? OR u.full_name LIKE ? OR o.customer_name LIKE ?)
                    ORDER BY o.updated_at DESC LIMIT 80
                    """,
                    (term, like, like, like),
                )))
            elif path == "/api/reports":
                period = query.get("period", ["today"])[0]
                # Determine timestamp threshold based on period
                ts = now()
                if period == "today":
                    # Simple assumption: last 24h for today
                    threshold = ts - 86400
                elif period == "yesterday":
                    threshold = ts - (86400 * 2)
                    ts = ts - 86400
                elif period == "week":
                    threshold = ts - (86400 * 7)
                elif period == "month":
                    threshold = ts - (86400 * 30)
                else:
                    threshold = ts - 86400
                    
                # Using a single query to get total sales and approximate costs
                totals = dict(conn.execute(
                    """
                    SELECT 
                        COUNT(DISTINCT o.id) AS orders, 
                        COALESCE(SUM(oi.line_total_cents),0) AS sales,
                        COALESCE(SUM(oi.qty * mi.cost_cents),0) AS costs
                    FROM orders o
                    JOIN order_items oi ON o.id = oi.order_id
                    LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
                    WHERE o.status = 'paid' AND o.updated_at >= ? AND o.updated_at <= ?
                    """,
                    (threshold, ts),
                ).fetchone())
                
                # Payment Breakdown
                payments = rows(conn.execute(
                    """
                    SELECT COALESCE(payment_method, 'cash') as method, SUM(total_cents) as amount
                    FROM orders 
                    WHERE status = 'paid' AND updated_at >= ? AND updated_at <= ?
                    GROUP BY payment_method
                    """,
                    (threshold, ts),
                ))
                
                # Top Items
                top_items = rows(conn.execute(
                    """
                    SELECT 
                        oi.name, 
                        SUM(oi.qty) AS qty, 
                        SUM(oi.line_total_cents) AS sales,
                        MAX(mi.stock_qty) as current_stock
                    FROM order_items oi 
                    JOIN orders o ON o.id = oi.order_id
                    LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
                    WHERE o.status = 'paid' AND o.updated_at >= ? AND o.updated_at <= ?
                    GROUP BY oi.name ORDER BY sales DESC LIMIT 15
                    """,
                    (threshold, ts),
                ))
                
                stock_stats = dict(conn.execute(
                    """
                    SELECT 
                        COALESCE(SUM(stock_qty * cost_cents), 0) as inventory_value,
                        COALESCE(SUM(stock_qty * (price_cents - cost_cents)), 0) as potential_profit
                    FROM menu_items 
                    WHERE active = 1 AND stock_qty > 0
                    """
                ).fetchone())
                
                self.send_json({"totals": totals, "payments": payments, "top_items": top_items, "period": period, "stock": stock_stats})
            elif path == "/api/admin/summary":
                if not self.require_manager(user):
                    return
                self.send_json(self.admin_summary(conn))
            elif path == "/api/admin/customers":
                self.send_json(rows(conn.execute("SELECT * FROM customers ORDER BY name")))
            elif path == "/api/admin/users":
                if not self.require_manager(user):
                    return
                self.send_json(rows(conn.execute(
                    "SELECT id, username, full_name, role, active FROM users ORDER BY role, full_name"
                )))
            elif path == "/api/admin/suppliers":
                if not self.require_manager(user):
                    return
                self.send_json(rows(conn.execute("SELECT * FROM suppliers ORDER BY name")))
            else:
                self.send_json({"error": "not_found"}, 404)

    def api_post(self, path, data, user, method="POST", query=None):
        with db() as conn:
            if path == "/api/orders":
                employee_id = data.get("employee_id") or user["id"]
                valid_employee = conn.execute(
                    "SELECT id FROM users WHERE id = ? AND role IN ('staff', 'cashier', 'manager', 'terminal') AND active = 1",
                    (int(employee_id),),
                ).fetchone()
                if not valid_employee:
                    employee_id = user["id"]
                ticket = next_ticket(conn)
                customer_name = data.get("customer_name", "") or ""
                cur = conn.execute(
                    """
                    INSERT INTO orders(ticket_no, order_type, customer_name, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (ticket, data.get("order_type", "walk-in"), customer_name, employee_id, now(), now()),
                )
                self.send_json(get_order_payload(conn, cur.lastrowid))
            elif path == "/api/order/add":
                order_id = int(data["order_id"])
                item = conn.execute("SELECT * FROM menu_items WHERE id = ? AND active = 1", (int(data["menu_item_id"]),)).fetchone()
                if not item:
                    return self.send_json({"error": "item_not_found"}, 404)
                existing = conn.execute(
                    "SELECT * FROM order_items WHERE order_id = ? AND menu_item_id = ? AND note = ''",
                    (order_id, item["id"]),
                ).fetchone()
                if existing:
                    qty = existing["qty"] + int(data.get("qty", 1))
                    conn.execute(
                        "UPDATE order_items SET qty = ?, line_total_cents = ? WHERE id = ?",
                        (qty, qty * item["price_cents"], existing["id"]),
                    )
                else:
                    qty = int(data.get("qty", 1))
                    conn.execute(
                        """
                        INSERT INTO order_items(order_id, menu_item_id, name, qty, unit_price_cents, line_total_cents)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (order_id, item["id"], item["name"], qty, item["price_cents"], qty * item["price_cents"]),
                    )
                recalc_order(conn, order_id)
                self.send_json(get_order_payload(conn, order_id))
            elif path == "/api/order/qty":
                item_id = int(data["item_id"])
                qty = max(0, int(data["qty"]))
                row = conn.execute("SELECT order_id, unit_price_cents FROM order_items WHERE id = ?", (item_id,)).fetchone()
                if not row:
                    return self.send_json({"error": "item_not_found"}, 404)
                if qty == 0:
                    conn.execute("DELETE FROM order_items WHERE id = ?", (item_id,))
                else:
                    conn.execute(
                        "UPDATE order_items SET qty = ?, line_total_cents = ? WHERE id = ?",
                        (qty, qty * row["unit_price_cents"], item_id),
                    )
                recalc_order(conn, row["order_id"])
                self.send_json(get_order_payload(conn, row["order_id"]))
            elif path == "/api/order/pay":
                order_id = int(data["order_id"])
                order = conn.execute("SELECT status, total_cents, customer_name FROM orders WHERE id = ?", (order_id,)).fetchone()
                if not order:
                    return self.send_json({"error": "order_not_found"}, 404)
                
                if order["status"] != "paid":
                    items = conn.execute("SELECT menu_item_id, qty FROM order_items WHERE order_id = ?", (order_id,)).fetchall()
                    for item in items:
                        if item["menu_item_id"]:
                            conn.execute("UPDATE menu_items SET stock_qty = stock_qty - ? WHERE id = ?", (item["qty"], item["menu_item_id"]))
                            conn.execute(
                                "INSERT INTO stock_movements(product_id, qty_change, reason, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                                (item["menu_item_id"], -item["qty"], "sale", f"Order #{order_id}", user["id"], now()),
                            )

                payment_method = data.get("payment_method", "cash")
                payment_ref = data.get("payment_ref", "").strip()
                customer_name = order["customer_name"]

                if payment_method == "mpesa" and payment_ref:
                    # Auto-save customer
                    customer = conn.execute("SELECT id, name FROM customers WHERE phone = ?", (payment_ref,)).fetchone()
                    if not customer:
                        conn.execute("INSERT INTO customers(name, phone, notes) VALUES ('Temp', ?, 'Auto-saved from M-Pesa purchase')", (payment_ref,))
                        new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                        new_name = f"Customer {new_id}"
                        conn.execute("UPDATE customers SET name = ? WHERE id = ?", (new_name, new_id))
                        if not customer_name:
                            customer_name = new_name
                    else:
                        if not customer_name:
                            customer_name = customer["name"]

                conn.execute(
                    "UPDATE orders SET status = 'paid', paid_cents = ?, payment_method = ?, payment_ref = ?, customer_name = ?, updated_at = ? WHERE id = ?",
                    (order["total_cents"], payment_method, payment_ref, customer_name, now(), order_id),
                )
                self.send_json(get_order_payload(conn, order_id))
            elif path == "/api/order/status":
                order_id = int(data["order_id"])
                status = data.get("status", "sent")
                conn.execute("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", (status, now(), order_id))
                self.send_json(get_order_payload(conn, order_id))
            elif path == "/api/menu/item" and method == "DELETE":
                item_id = int(query.get("id", [0])[0])
                try:
                    conn.execute("DELETE FROM menu_items WHERE id = ?", (item_id,))
                    CACHE["menu"] = None
                    self.send_json(self.menu_payload(conn))
                except sqlite3.IntegrityError:
                    self.send_json({"error": "Cannot delete product. It has already been sold on past receipts or has stock history."}, status=400)
            elif path == "/api/menu/item":
                price_cents = int(float(data.get("price", "0")) * 100)
                cost_cents = int(float(data.get("cost", "0")) * 100)
                sku = data.get("sku", "").strip() or None
                barcode = data.get("barcode", "").strip() or None
                unit = data.get("unit", "pcs").strip() or "pcs"
                stock_qty = int(data.get("stock_qty", 0))
                
                image_url = data.get("image_url")
                if data.get("image_base64"):
                    import base64, uuid, os
                    img_data = data["image_base64"]
                    if "," in img_data:
                        img_data = img_data.split(",")[1]
                    filename = f"{uuid.uuid4().hex}.jpg"
                    os.makedirs("static/uploads", exist_ok=True)
                    with open(f"static/uploads/{filename}", "wb") as f:
                        f.write(base64.b64decode(img_data))
                    image_url = f"/static/uploads/{filename}"

                if data.get("id"):
                    conn.execute(
                        "UPDATE menu_items SET category_id=?, name=?, price_cents=?, cost_cents=?, color=?, active=?, sku=?, barcode=?, unit=?, stock_qty=?, image_url=? WHERE id=?",
                        (int(data["category_id"]), data["name"], price_cents, cost_cents, data.get("color", "#334155"), int(data.get("active", 1)), sku, barcode, unit, stock_qty, image_url, int(data["id"])),
                    )
                else:
                    conn.execute(
                        "INSERT INTO menu_items(category_id, name, price_cents, cost_cents, color, sku, barcode, unit, stock_qty, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (int(data["category_id"]), data["name"], price_cents, cost_cents, data.get("color", "#334155"), sku, barcode, unit, stock_qty, image_url),
                    )
                CACHE["menu"] = None
                self.send_json(self.menu_payload(conn))
            elif path == "/api/admin/user":
                if not self.require_manager(user):
                    return
                username = data.get("username", "").strip()
                full_name = data.get("full_name", "").strip()
                role = data.get("role", "staff")
                active = int(data.get("active", 1))
                password = data.get("password", "").strip()
                if role not in ("staff", "cashier", "manager"):
                    return self.send_json({"error": "bad_role"}, 400)
                if not username or not full_name:
                    return self.send_json({"error": "missing_user_fields"}, 400)
                if data.get("id"):
                    user_id = int(data["id"])
                    if password:
                        conn.execute(
                            "UPDATE users SET username=?, full_name=?, role=?, active=?, password_hash=? WHERE id=?",
                            (username, full_name, role, active, hash_password(password), user_id),
                        )
                    else:
                        conn.execute(
                            "UPDATE users SET username=?, full_name=?, role=?, active=? WHERE id=?",
                            (username, full_name, role, active, user_id),
                        )
                else:
                    if not password:
                        password = "1234" if role == "staff" else "admin123"
                    conn.execute(
                        "INSERT INTO users(username, full_name, role, active, password_hash) VALUES (?, ?, ?, ?, ?)",
                        (username, full_name, role, active, hash_password(password)),
                    )
                self.send_json(rows(conn.execute(
                    "SELECT id, username, full_name, role, active FROM users ORDER BY role, full_name"
                )))
            elif path == "/api/purchase":
                supplier_id = int(data["supplier_id"])
                product_id = int(data["product_id"])
                qty = int(data["qty"])
                cost = int(data["cost_cents"])
                total = qty * cost
                conn.execute("UPDATE menu_items SET cost_cents = ?, stock_qty = stock_qty + ?, supplier_id = ? WHERE id = ?", (cost, qty, supplier_id, product_id))
                conn.execute(
                    "INSERT INTO stock_purchases (supplier_id, product_id, qty_received, cost_per_unit_cents, total_cost_cents, date_received, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (supplier_id, product_id, qty, cost, total, now(), user["id"])
                )
                conn.execute(
                    "INSERT INTO stock_movements (product_id, qty_change, reason, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (product_id, qty, 'purchase', f'Supplier {supplier_id}', user["id"], now())
                )
                self.send_json({"success": True})
            elif path == "/api/admin/supplier":
                name = data.get("name", "").strip()
                phone = data.get("phone", "").strip()
                email = data.get("email", "").strip()
                address = data.get("address", "").strip()
                active = int(data.get("active", 1))
                if not name:
                    return self.send_json({"error": "missing_supplier_name"}, 400)
                if data.get("id"):
                    conn.execute(
                        "UPDATE suppliers SET name=?, phone=?, email=?, address=?, active=? WHERE id=?",
                        (name, phone, email, address, active, int(data["id"])),
                    )
                else:
                    conn.execute(
                        "INSERT INTO suppliers(name, phone, email, address, active) VALUES (?, ?, ?, ?, ?)",
                        (name, phone, email, address, active),
                    )
                self.send_json(rows(conn.execute("SELECT * FROM suppliers ORDER BY name")))
            elif path == "/api/admin/customer":
                name = data.get("name", "").strip()
                phone = data.get("phone", "").strip()
                email = data.get("email", "").strip()
                notes = data.get("notes", "").strip()
                if not name:
                    return self.send_json({"error": "missing_customer_name"}, 400)
                if data.get("id"):
                    conn.execute(
                        "UPDATE customers SET name=?, phone=?, email=?, notes=? WHERE id=?",
                        (name, phone, email, notes, int(data["id"])),
                    )
                else:
                    conn.execute(
                        "INSERT INTO customers(name, phone, email, notes) VALUES (?, ?, ?, ?)",
                        (name, phone, email, notes),
                    )
                self.send_json(rows(conn.execute("SELECT * FROM customers ORDER BY name")))
            elif path == "/api/stock/adjust":
                if not self.require_manager(user):
                    return
                product_id = int(data["product_id"])
                qty_change = int(data["qty_change"])
                reason = data.get("reason", "adjustment")
                note = data.get("note", "")
                conn.execute(
                    "UPDATE menu_items SET stock_qty = stock_qty + ? WHERE id = ?",
                    (qty_change, product_id),
                )
                conn.execute(
                    "INSERT INTO stock_movements(product_id, qty_change, reason, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (product_id, qty_change, reason, note, user["id"], now()),
                )
                CACHE["menu"] = None
                self.send_json({"ok": True, "product_id": product_id, "qty_change": qty_change})
            else:
                self.send_json({"error": "not_found"}, 404)

    def menu_payload(self, conn):
        if CACHE["menu"] and now() - CACHE["menu_ts"] < 20:
            return CACHE["menu"]
        categories = rows(conn.execute("SELECT * FROM categories ORDER BY sort_order, name"))
        items = rows(conn.execute("SELECT * FROM menu_items WHERE active = 1 ORDER BY category_id, name"))
        payload = {"categories": categories, "items": items}
        CACHE["menu"] = payload
        CACHE["menu_ts"] = now()
        return payload

    def tables_payload(self, conn):
        return rows(conn.execute(
            """
            SELECT t.*, o.id AS order_id, o.ticket_no, o.total_cents
            FROM dining_tables t
            LEFT JOIN orders o ON o.table_id = t.id AND o.status IN ('open', 'sent')
            WHERE t.active = 1 ORDER BY t.id
            """
        ))

    def employees_payload(self, conn):
        return rows(conn.execute(
            """
            SELECT MIN(id) AS id, full_name AS name
            FROM users
            WHERE role IN ('staff', 'cashier', 'manager') AND active = 1
            GROUP BY full_name
            ORDER BY full_name
            """
        ))

    def admin_summary(self, conn):
        day_start = now() - 86400
        week_start = now() - 604800
        totals = dict(conn.execute(
            """
            SELECT
              COUNT(CASE WHEN status = 'paid' AND updated_at >= ? THEN 1 END) AS paid_today,
              COALESCE(SUM(CASE WHEN status = 'paid' AND updated_at >= ? THEN total_cents END), 0) AS sales_today,
              COUNT(CASE WHEN status IN ('open','sent') THEN 1 END) AS unpaid_orders,
              COALESCE(SUM(CASE WHEN status IN ('open','sent') THEN total_cents END), 0) AS unpaid_total,
              COALESCE(SUM(CASE WHEN status = 'paid' AND updated_at >= ? THEN total_cents END), 0) AS sales_week
            FROM orders
            """,
            (day_start, day_start, week_start),
        ).fetchone())
        by_employee = rows(conn.execute(
            """
            SELECT u.full_name AS employee, COUNT(o.id) AS orders, COALESCE(SUM(o.total_cents), 0) AS sales
            FROM orders o JOIN users u ON u.id = o.created_by
            WHERE o.status = 'paid' AND o.updated_at >= ?
            GROUP BY u.id, u.full_name
            ORDER BY sales DESC LIMIT 8
            """,
            (week_start,),
        ))
        by_method = rows(conn.execute(
            """
            SELECT COALESCE(payment_method, 'unknown') AS method, COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS sales
            FROM orders
            WHERE status = 'paid' AND updated_at >= ?
            GROUP BY payment_method ORDER BY sales DESC
            """,
            (week_start,),
        ))
        top_items = rows(conn.execute(
            """
            SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.line_total_cents) AS sales
            FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE o.status = 'paid' AND o.updated_at >= ?
            GROUP BY oi.name ORDER BY sales DESC LIMIT 8
            """,
            (week_start,),
        ))
        counts = dict(conn.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM users WHERE active = 1 AND role NOT IN ('terminal')) AS active_users,
              (SELECT COUNT(*) FROM menu_items WHERE active = 1) AS active_items,
              (SELECT COUNT(*) FROM suppliers WHERE active = 1) AS active_suppliers
            """
        ).fetchone())
        sales_trend = rows(conn.execute(
            """
            SELECT strftime('%Y-%m-%d', updated_at, 'unixepoch', 'localtime') AS day, COALESCE(SUM(total_cents), 0) AS sales
            FROM orders
            WHERE status = 'paid' AND updated_at >= ?
            GROUP BY day ORDER BY day ASC
            """,
            (week_start,)
        ))
        return {
            "totals": totals,
            "counts": counts,
            "by_employee": by_employee,
            "by_method": by_method,
            "top_items": top_items,
            "sales_trend": sales_trend,
        }

    do_DELETE = do_POST

if __name__ == "__main__":
    init_db()
    print(f"{STORE_NAME} Retail POS running at http://{HOST}:{PORT}")
    print("Staff PIN login: 1234 | Admin login: admin / admin123")

    class ReuseServer(ThreadingHTTPServer):
        allow_reuse_address = True

    ReuseServer((HOST, PORT), POSHandler).serve_forever()
