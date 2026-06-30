# SwiftBite POS

A lightweight local restaurant POS built for low memory usage.

## Run

```powershell
cd D:\POS
python app.py
```

Then open this manually:

```text
http://127.0.0.1:8080
```

POS login:

```text
PIN: 1234
```

After login, pick the waiter/employee on the POS screen before creating the ticket.

Cashier login:

```text
username: admin
password: admin123
```

## What It Includes

- Touch-friendly POS sales screen
- SQLite database in `data/pos.sqlite3`
- Tables, orders, kitchen queue, menu setup, and daily reports
- Cashier payment confirmation page for M-Pesa, cash, or card
- Printable due receipts for unpaid tickets
- No MySQL, no Node packages, no frontend framework
- SQLite WAL mode and small cached menu payload for fast local use

## Notes

This is designed for a single restaurant counter or LAN terminal. For production, change the default password and keep regular backups of the `data` folder.
