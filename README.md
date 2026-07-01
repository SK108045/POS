# EITY FIT POS

A simple Point of Sale (POS) system for retail and hardware stores. It is built with Python, SQLite, HTML, CSS, and vanilla JavaScript, with a focus on being lightweight and easy to run without requiring additional frameworks or services.

The system includes inventory management, sales processing, supplier management, reporting, and user roles for cashiers and administrators.

---

## Features

- Lightweight Python backend
- SQLite database
- Responsive interface for desktop and touch displays
- Inventory management
- Supplier and purchase management
- Sales processing
- Cashier and administrator accounts
- Product image uploads
- Reporting dashboard

---

## Technologies Used

- Python
- SQLite
- HTML
- CSS
- JavaScript

---

## Installation

Clone the repository:

```bash
git clone https://github.com/SK108045/POS.git
cd POS
```

Start the server:

```bash
python app.py
```

By default, the application runs at:

```
http://127.0.0.1:3000
```

To use a different port:

```bash
POS_PORT=8080 python app.py
```

---

## Default Credentials

| Role | Credentials |
|------|-------------|
| Cashier | PIN: `1234` |
| Administrator | Username: `admin`<br>Password: `admin123` |

> **Note:** Change the default credentials before using the application in production.

---

## Project Structure

```text
.
├── app.py
├── static/
│   ├── app.js
│   ├── admin.js
│   ├── styles.css
│   └── admin.css
├── data/
│   └── pos.sqlite3
├── start-pos.bat
└── README.md
```

---

## Overview

The backend is contained in `app.py`, which serves the web interface and provides the API endpoints used by the frontend.

The frontend communicates with the backend through `/api/*` endpoints to manage products, inventory, suppliers, purchases, sales, and reports.

Application data is stored in an SQLite database located in the `data` directory.

---
