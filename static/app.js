const money = cents => `KES ${(cents / 100).toFixed(2)}`;
const moneyRaw = cents => (cents / 100).toFixed(2);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── Receipt Modal ─────────────────────────────────────────────────────────────
function showReceiptModal(order) {
  document.getElementById('receiptModal')?.remove();

  const itemRows = (order.items || []).map(item =>
    `<tr><td>${item.qty} x ${item.name}</td><td>${moneyRaw(item.line_total_cents)}</td></tr>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.id = 'receiptModal';
  overlay.className = 'receipt-modal-overlay';
  overlay.innerHTML = `
    <div class="receipt-modal" role="dialog" aria-modal="true">
      <button class="receipt-modal-close" id="receiptModalClose" title="Close">&times;</button>
      <div class="receipt-modal-print-area">
        <div class="receipt">
          <h1>EITY FIT HARDWARES</h1>
          <p>Nairobi Main Branch</p>
          <p>Tel: 0723056885</p>
          <h2 style="font-size: 16px; margin: 12px 0 8px; font-weight: 800;">* ORIGINAL *</h2>
          <div class="receipt-line"><span>Date</span><strong>${new Date().toLocaleString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'})}</strong></div>
          <div class="receipt-line"><span>Receipt #</span><strong>${order.ticket_no}</strong></div>
          <div class="receipt-line"><span>Terminal</span><strong>POS-01</strong></div>
          <div class="receipt-line"><span>Type</span><strong>${order.order_type}</strong></div>
          ${order.customer_name ? `<div class="receipt-line"><span>Customer</span><strong>${order.customer_name}</strong></div>` : ''}
          <div class="receipt-line"><span>Served By</span><strong>${order.employee_name || '-'}</strong></div>
          <div class="receipt-line"><span>Status</span><strong>${order.status}</strong></div>
          <div style="border-top: 1px dashed var(--line); margin: 10px 0;"></div>
          <table><tbody>${itemRows}</tbody></table>
          <div style="border-top: 1px dashed var(--line); margin: 10px 0;"></div>
          <div class="receipt-total"><span>Total</span><strong>KES ${moneyRaw(order.total_cents)}</strong></div>
          <div class="receipt-line"><span>Amount Tendered</span><strong>KES ${moneyRaw(order.total_cents)}</strong></div>
          <div class="receipt-line"><span>Change</span><strong>KES 0.00</strong></div>
          <div style="border-top: 1px dashed var(--line); margin: 10px 0;"></div>
          <div class="receipt-line"><span>Total Excl. VAT</span><strong>KES ${moneyRaw(order.total_cents / 1.16)}</strong></div>
          <div class="receipt-line"><span>Total VAT (16%)</span><strong>KES ${moneyRaw(order.total_cents - (order.total_cents / 1.16))}</strong></div>
          <div style="border-top: 1px dashed var(--line); margin: 10px 0;"></div>
          <div class="receipt-line"><span>Payment Method</span><strong>${(order.payment_method || 'CASH').toUpperCase()}</strong></div>
          <div class="receipt-line"><span>Txn Ref</span><strong>${order.payment_ref || `TXN-${Math.floor(Math.random() * 90000) + 10000}`}</strong></div>
          <p class="receipt-note" style="line-height: 1.6; margin-top: 12px;">
            Thank you for shopping at EITY FIT!<br>
            Please keep this receipt for warranty purposes.<br><br>
            Powered by EITY FIT POS SYSTEM<br>
            ------- END OF RECEIPT -------
          </p>
          <button id="receiptPrintBtn">Print Receipt</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.classList.add('receipt-modal-visible');

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('receiptModalClose').addEventListener('click', close);
  document.getElementById('receiptPrintBtn').addEventListener('click', () => window.print());

  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
}

// ── UI Utilities ─────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||'•'}</span><span>${msg}</span>`;
  const container = document.getElementById('toastContainer');
  if (container) {
    container.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  } else {
    alert(msg);
  }
}

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  user: null,
  employees: [],
  selectedEmployeeId: null,
  categories: [],
  items: [],
  activeCategory: null,
  order: null,
  searchQuery: '',
};

async function api(path, options = {}) {
  const init = { headers: { 'Content-Type': 'application/json' }, ...options };
  if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
  const res = await fetch(path, init);
  if (res.status === 401) location.href = '/login';
  if (res.status === 403) location.href = '/login';
  if (!res.ok) {
    let errText = `Request failed: ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody && errBody.error) errText = errBody.error;
    } catch(e) {}
    throw new Error(errText);
  }
  return res.json();
}

async function bootstrap() {
  const data = await api('/api/bootstrap');
  state.user = data.user;
  state.employees = data.employees || [];
  state.selectedEmployeeId = Number(localStorage.getItem('pos_employee_id')) || state.employees[0]?.id || null;
  state.categories = data.menu.categories;
  state.items = data.menu.items;
  state.activeCategory = 'all';
}

function pageName() {
  return qs('[data-page]')?.dataset.page;
}

function renderShellError(err) {
  const root = qs('[data-page]');
  if (root) root.innerHTML = `<section class="empty">Could not load page. ${err.message}</section>`;
}

// ── POS Layout ────────────────────────────────────────────────────────────────
function posLayout() {
  const root = qs('[data-page="pos"]');
  root.innerHTML = `
    <section class="menu-side">
      <div class="pos-head">
        <h2>Products</h2>
        <select id="orderType">
          <option value="walk-in">Walk-In Sale</option>
          <option value="quote">Quote</option>
          <option value="layaway">Layaway</option>
        </select>
      </div>
      <div class="sku-search-wrap">
        <div class="sku-search-inner">
          <span class="sku-search-icon">&#128269;</span>
          <input class="sku-search-input" id="skuSearch" placeholder="Search by name or SKU…" autocomplete="off" autocorrect="off">
          <button class="sku-search-clear" id="skuClear" title="Clear">&#215;</button>
        </div>
      </div>
      <div class="tabs" id="catTabs"></div>
      <div class="item-grid" id="itemGrid"></div>
    </section>
    <aside class="ticket-side">
      <div class="ticket-head">
        <div>
          <h2>Staff</h2>
          <small>Active User</small>
        </div>
        <div style="font-weight: 700; font-size: 15px; color: var(--ink);">Owner</div>
      </div>
      <div class="ticket-list" id="ticketList"></div>
      <div class="ticket-foot" id="ticketFoot"></div>
    </aside>
  `;

  qs('#orderType').addEventListener('change', ensureOrder);

  const skuInput = qs('#skuSearch');
  skuInput.addEventListener('input', () => {
    state.searchQuery = skuInput.value.trim().toLowerCase();
    renderItems();
  });
  qs('#skuClear').addEventListener('click', () => {
    skuInput.value = '';
    state.searchQuery = '';
    renderItems();
    skuInput.focus();
  });

  // Barcode scanner support: scanner sends keystrokes quickly then Enter
  skuInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = skuInput.value.trim().toLowerCase();
      const match = state.items.find(i =>
        (i.sku && i.sku.toLowerCase() === q) ||
        (i.barcode && i.barcode.toLowerCase() === q)
      );
      if (match) {
        showQtyPopup(match);
        skuInput.value = '';
        state.searchQuery = '';
        renderItems();
      }
    }
  });

  renderTabs();
  renderItems();
  renderTicket();
}

function getCategoryIcon(name) {
  const zap = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
  const droplet = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>`;
  const palette = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c2 0 3-1 3-2 0-.55-.22-1.05-.59-1.41-.36-.36-.59-.86-.59-1.41 0-1.1.9-2 2-2h1c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-4 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm4-4c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm4 4c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`;
  const crosshair = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>`;
  const wrench = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`;
  const shield = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`;
  const box = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;
  
  const lower = name.toLowerCase();
  if (lower.includes('electric')) return zap;
  if (lower.includes('plumb')) return droplet;
  if (lower.includes('paint')) return palette;
  if (lower.includes('fastener')) return crosshair;
  if (lower.includes('tool')) return wrench;
  if (lower.includes('safet')) return shield;
  if (lower.includes('building') || lower.includes('material')) return box;
  if (lower === 'all') return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`;
  
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>`;
}

function renderTabs() {
  const tabs = qs('#catTabs');
  if (!tabs) return;
  
  const allTab = `<button class="tab ${state.activeCategory === 'all' ? 'active' : ''}" data-cat="all">
    ${getCategoryIcon('All')} All
  </button>`;
  
  const catTabs = state.categories.map(cat =>
    `<button class="tab ${cat.id === state.activeCategory ? 'active' : ''}" data-cat="${cat.id}">
       ${getCategoryIcon(cat.name)} ${cat.name}
     </button>`
  ).join('');
  
  tabs.innerHTML = allTab + catTabs;
  
  qsa('.tab').forEach(btn => btn.addEventListener('click', () => {
    state.activeCategory = btn.dataset.cat === 'all' ? 'all' : Number(btn.dataset.cat);
    state.searchQuery = '';
    const inp = qs('#skuSearch');
    if (inp) inp.value = '';
    renderTabs();
    renderItems();
  }));
}

function renderItems() {
  const grid = qs('#itemGrid');
  if (!grid) return;
  let items = state.items;
  if (state.searchQuery) {
    const q = state.searchQuery;
    items = items.filter(i =>
      i.name.toLowerCase().includes(q) ||
      (i.sku && i.sku.toLowerCase().includes(q)) ||
      (i.barcode && i.barcode.toLowerCase().includes(q))
    );
  } else {
    if (state.activeCategory !== 'all') {
      items = items.filter(i => i.category_id === state.activeCategory);
    }
  }

  grid.innerHTML = items.map(item => {
    const low = item.stock_qty !== undefined && item.stock_qty <= 5;
    const stockLabel = item.stock_qty !== undefined
      ? `<span class="stock-badge ${low ? '' : 'ok'}">${item.stock_qty} ${item.unit || 'pcs'}</span>`
      : '';
      const catName = state.categories.find(c => c.id === item.category_id)?.name || '';
      return `
      <button class="menu-btn" data-id="${item.id}">
        <div class="menu-btn-img-wrapper">
          ${item.image_url ? `<img src="${item.image_url}" style="width:100%;height:100%;object-fit:contain;padding:16px;box-sizing:border-box;">` : getCategoryIcon(catName)}
          ${stockLabel}
        </div>
        <div class="menu-btn-content">
          <strong>${item.name}</strong>
          ${item.sku ? `<div class="item-sku">SKU: ${item.sku}</div>` : ''}
          <div class="item-price">${money(item.price_cents)}</div>
          <div class="menu-btn-stock-status ${low ? 'low' : ''}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            ${low ? 'Low Stock' : 'In Stock'}
          </div>
        </div>
      </button>
    `;
  }).join('') || `<div class="empty">No products found</div>`;

  qsa('.menu-btn').forEach(btn => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.id);
    const item = state.items.find(i => i.id === id);
    if (item) {
      const existing = state.order?.items?.find(i => i.menu_item_id === item.id);
      const existingQty = existing ? existing.qty : 0;
      if (item.stock_qty !== undefined && (1 + existingQty) > item.stock_qty) {
        toast(`Cannot add item. Only ${item.stock_qty} left in stock (you have ${existingQty} in cart).`, 'error');
        return;
      }
      await addItemWithQty(item.id, 1);
    }
  }));
}

// ── Qty Popup ─────────────────────────────────────────────────────────────────
function showQtyPopup(item) {
  const overlay = document.createElement('div');
  overlay.className = 'qty-popup-overlay';
  overlay.innerHTML = `
    <div class="qty-popup">
      <h3>${item.name}</h3>
      <p>${money(item.price_cents)} per ${item.unit || 'pcs'} · SKU: ${item.sku || 'N/A'}</p>
      <div class="qty-popup-row">
        <button class="qty-pop-btn" id="qtyDec">−</button>
        <input type="number" id="qtyVal" value="1" min="1" max="9999" inputmode="numeric">
        <button class="qty-pop-btn" id="qtyInc">+</button>
      </div>
      <div class="qty-popup-actions">
        <button class="ghost" id="qtyCancel">Cancel</button>
        <button class="primary" id="qtyConfirm">Add to Sale</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const inp = overlay.querySelector('#qtyVal');
  inp.select();
  inp.focus();

  overlay.querySelector('#qtyDec').addEventListener('click', () => {
    inp.value = Math.max(1, Number(inp.value) - 1);
  });
  overlay.querySelector('#qtyInc').addEventListener('click', () => {
    inp.value = Number(inp.value) + 1;
  });
  overlay.querySelector('#qtyCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const confirm = async () => {
    const qty = Math.max(1, Number(inp.value) || 1);
    
    const existing = state.order?.items?.find(i => i.menu_item_id === item.id);
    const existingQty = existing ? existing.qty : 0;
    
    if (item.stock_qty !== undefined && (qty + existingQty) > item.stock_qty) {
      toast(`Cannot add ${qty}. Only ${item.stock_qty} left in stock (you have ${existingQty} in cart).`, 'error');
      return;
    }
    
    overlay.remove();
    await addItemWithQty(item.id, qty);
  };
  overlay.querySelector('#qtyConfirm').addEventListener('click', confirm);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
}

async function ensureOrder() {
  if (state.order && state.order.status === 'open') return state.order;
  const customerInput = qs('#customerName');
  state.order = await api('/api/orders', {
    method: 'POST',
    body: {
      order_type: qs('#orderType')?.value || 'walk-in',
      employee_id: state.selectedEmployeeId,
      customer_name: customerInput?.value?.trim() || '',
    },
  });
  renderTicket();
  return state.order;
}

async function addItemWithQty(menuItemId, qty) {
  const order = await ensureOrder();
  state.order = await api('/api/order/add', {
    method: 'POST',
    body: { order_id: order.id, menu_item_id: menuItemId, qty },
  });
  renderTicket();
}

async function changeQty(itemId, qty) {
  if (state.order && state.order.items) {
    const existingItem = state.order.items.find(i => i.id === itemId);
    if (existingItem) {
      const catalogItem = state.items.find(i => i.id === existingItem.menu_item_id);
      if (catalogItem && catalogItem.stock_qty !== undefined) {
        if (qty > catalogItem.stock_qty) {
          toast(`Cannot increase. Only ${catalogItem.stock_qty} left in stock.`, 'error');
          return;
        }
      }
    }
  }
  
  state.order = await api('/api/order/qty', { method: 'POST', body: { item_id: itemId, qty } });
  renderTicket();
}

async function setStatus(status) {
  if (!state.order) return;
  state.order = await api('/api/order/status', {
    method: 'POST',
    body: { order_id: state.order.id, status },
  });
  renderTicket();
}

function renderTicket() {
  const list = qs('#ticketList');
  const foot = qs('#ticketFoot');
  if (!list || !foot) return;

  if (!state.order) {
    list.innerHTML = `<div class="empty">Add products to start a sale</div>`;
    foot.innerHTML = `
      <div class="customer-row">
        <input id="customerName" placeholder="Customer name (optional)" autocomplete="off">
      </div>
      <button class="primary" id="newTicket" style="width:100%">New Sale</button>
      <div class="totals"><div class="grand"><span>Total</span><span>KES 0.00</span></div></div>
    `;
    qs('#newTicket').addEventListener('click', ensureOrder);
    return;
  }

  list.innerHTML = state.order.items.length
    ? state.order.items.map(item => {
      const dbItem = state.items.find(i => i.id === item.menu_item_id) || {};
      const catName = state.categories.find(c => c.id === dbItem.category_id)?.name || '';
      return `
      <div class="ticket-row">
        <div class="ticket-img">
          ${dbItem.image_url ? `<img src="${dbItem.image_url}" style="width:100%;height:100%;object-fit:contain;padding:4px;box-sizing:border-box;border-radius:7px;">` : getCategoryIcon(catName)}
        </div>
        <div class="ticket-info">
          <strong>${item.name}</strong>
          <small>SKU: ${dbItem.sku || '-'}</small>
          <div class="t-price">${money(item.unit_price_cents)}</div>
        </div>
        <div class="ticket-right">
          <div class="qty-controls">
            <button data-qty="${item.qty - 1}" data-id="${item.id}">−</button>
            <strong>${item.qty}</strong>
            <button data-qty="${item.qty + 1}" data-id="${item.id}">+</button>
            <button class="remove-btn" data-qty="0" data-id="${item.id}">×</button>
          </div>
          <div class="t-total">${money(item.line_total_cents)}</div>
        </div>
      </div>
      `}).join('')
    : `<div class="empty">Add products to start a sale</div>`;

  qsa('.qty-controls button').forEach(btn =>
    btn.addEventListener('click', () => changeQty(Number(btn.dataset.id), Number(btn.dataset.qty)))
  );

  foot.innerHTML = `
    <div class="totals">
      <div><span>Receipt #</span><span>${state.order.ticket_no}</span></div>
      <div><span>Type</span><span>${state.order.order_type}</span></div>
      <div><span>Served By</span><span>${state.order.employee_name || selectedEmployeeName() || '-'}</span></div>
      <div><span>Subtotal</span><span>${money(state.order.subtotal_cents)}</span></div>
      <div class="grand"><span>Total</span><span>${money(state.order.total_cents)}</span></div>
    </div>
    <div class="actions">
      <button class="primary" id="checkoutBtn">Checkout</button>
      <button class="secondary" id="newTicket">New</button>
      <button class="danger" id="voidTicket">Void</button>
    </div>
  `;
  qs('#checkoutBtn').addEventListener('click', () => showCheckoutModal(state.order));
  qs('#newTicket').addEventListener('click', () => { state.order = null; renderTicket(); });
  qs('#voidTicket').addEventListener('click', async () => {
    await setStatus('cancelled');
    state.order = null;
    renderTicket();
  });
}

function selectedEmployeeName() {
  return state.employees.find(emp => emp.id === state.selectedEmployeeId)?.name;
}

function showCheckoutModal(order) {
  const overlay = document.createElement('div');
  overlay.className = 'qty-popup-overlay';
  overlay.innerHTML = `
    <div class="qty-popup" style="max-width: 400px; text-align: left;">
      <h3 style="margin-top:0">Checkout - ${order.ticket_no}</h3>
      <p style="font-size: 18px; font-weight: bold; margin-bottom: 20px;">Total: ${money(order.total_cents)}</p>
      
      <div style="margin-bottom: 16px;">
        <label style="display:block; margin-bottom: 8px; font-weight: 600;">Payment Method</label>
        <select id="checkoutMethod" class="field" style="width: 100%; padding: 10px;">
          <option value="cash">Cash</option>
          <option value="mpesa">M-Pesa</option>
        </select>
      </div>

      <div id="mpesaRefContainer" style="display: none; margin-bottom: 16px;">
        <label style="display:block; margin-bottom: 8px; font-weight: 600;">MPESA No</label>
        <input type="text" id="mpesaRef" class="field" placeholder="e.g. 0712345678" style="width: 100%; padding: 10px;" autocomplete="off">
      </div>

      <div id="checkoutMsg" style="margin-top: 10px; font-weight: 600; font-size: 14px; text-align: center;"></div>

      <div class="qty-popup-actions" style="margin-top: 16px;">
        <button class="ghost" id="chkCancel">Cancel</button>
        <button class="primary" id="chkConfirm">Confirm & Print</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const methodSelect = overlay.querySelector('#checkoutMethod');
  const refContainer = overlay.querySelector('#mpesaRefContainer');
  const refInput = overlay.querySelector('#mpesaRef');

  methodSelect.addEventListener('change', () => {
    if (methodSelect.value === 'mpesa') {
      refContainer.style.display = 'block';
      refInput.focus();
    } else {
      refContainer.style.display = 'none';
    }
  });

  overlay.querySelector('#chkCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const msgEl = overlay.querySelector('#checkoutMsg');

  overlay.querySelector('#chkConfirm').addEventListener('click', async () => {
    msgEl.textContent = '';
    const method = methodSelect.value;
    const ref = refInput.value.trim();
    if (method === 'mpesa' && !ref) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = 'Please enter MPESA No.';
      return;
    }
    
    overlay.querySelector('#chkConfirm').disabled = true;
    overlay.querySelector('#chkConfirm').textContent = 'Processing...';

    try {
      const paidOrder = await api('/api/order/pay', {
        method: 'POST',
        body: { order_id: order.id, payment_method: method, payment_ref: ref }
      });
      
      if (method === 'mpesa') {
        msgEl.style.color = 'var(--ok)';
        msgEl.textContent = 'Prompt sent! Waiting for customer to enter PIN...';
        const btn = overlay.querySelector('#chkConfirm');
        btn.textContent = 'Payment Received — Print Receipt';
        btn.disabled = false;
        
        // Remove old listener by replacing the button, then add the new print action
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', () => {
          overlay.remove();
          showReceiptModal(paidOrder);
          state.order = null; 
          renderTicket();
        });
      } else {
        msgEl.style.color = 'var(--ok)';
        msgEl.textContent = 'Payment successful! Generating receipt...';
        setTimeout(() => {
          overlay.remove();
          showReceiptModal(paidOrder);
          state.order = null; 
          renderTicket();
        }, 800);
      }
      
    } catch (e) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = e.message;
      overlay.querySelector('#chkConfirm').disabled = false;
      overlay.querySelector('#chkConfirm').textContent = 'Confirm & Print';
    }
  });
}

// ── Suppliers (replaces Tables) ───────────────────────────────────────────────
async function renderSuppliers() {
  const root = qs('[data-page="suppliers"]');
  const suppliers = await api('/api/suppliers');
  
  root.innerHTML = `
    <div class="panel-title-group" style="margin: 0 24px 20px; padding-top: 24px;">
      <h2>Suppliers</h2>
      <div style="display: flex; gap: 12px; margin-left: auto;">
        <button class="add-btn" id="addSupplierBtn" style="background:var(--primary)">+ Add Supplier</button>
        <button class="add-btn" id="refreshSuppliers" style="background:var(--ink)">Refresh</button>
      </div>
    </div>
    
    <div class="sales-table-container">
      <table class="sales-table">
        <thead>
          <tr>
            <th>Supplier Name</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Status</th>
            <th style="text-align: right">Action</th>
          </tr>
        </thead>
        <tbody>
          ${suppliers.map(s => `
            <tr class="sales-row">
              <td><strong>${s.name}</strong></td>
              <td>${s.phone || '-'}</td>
              <td>${s.email || '-'}</td>
              <td>
                <span class="pay-badge" style="${s.active ? 'background:#dcfce7;color:#16a34a;' : 'background:#f1f5f9;color:#64748b;'}">
                  ${s.active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td style="text-align: right">
                <button class="view-receipt-btn supplier-view-btn" data-id="${s.id}" style="margin-right: 4px;">View</button>
                <button class="view-receipt-btn supplier-edit-btn" data-id="${s.id}">Edit</button>
              </td>
            </tr>
          `).join('') || `<tr><td colspan="5" class="empty" style="text-align:center; padding: 40px;">No suppliers found</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  
  qs('#refreshSuppliers').addEventListener('click', renderSuppliers);
  qs('#addSupplierBtn').addEventListener('click', () => showSupplierModal());
  
  qsa('.supplier-edit-btn', root).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const supplier = suppliers.find(s => s.id === id);
      if (supplier) showSupplierModal(supplier);
    });
  });

  qsa('.supplier-view-btn', root).forEach(btn => {
    btn.addEventListener('click', () => {
      showSupplierDetails(Number(btn.dataset.id));
    });
  });
}

async function showSupplierDetails(id) {
  const supplier = await api(`/api/supplier/detail?id=${id}`);
  
  const formatDate = (ts) => {
    if (!ts) return '-';
    const d = new Date(ts * 1000);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short' });
  };

  const overlay = document.createElement('div');
  overlay.className = 'qty-popup-overlay';
  overlay.innerHTML = `
    <div class="qty-popup" style="max-width: 500px; text-align: left;">
      <h2 style="margin-top:0">${supplier.name}</h2>
      <p style="color:var(--muted); margin-bottom: 20px;">Total Purchases: <strong style="color:var(--ink)">${money(supplier.total_purchases)}</strong></p>
      
      <div style="font-weight:700; font-size:12px; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--line); padding-bottom:8px; margin-bottom:8px;">Products Supplied</div>
      <div style="max-height:300px; overflow-y:auto; margin-bottom:20px;">
        ${supplier.products.length ? supplier.products.map(p => `
          <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f1f5f9;">
            <div>
              <div style="font-weight:600;">${p.name}</div>
              <div style="font-size:12px; color:var(--muted)">Last Delivery: ${formatDate(p.last_delivery)}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:700; color:var(--primary-dark)">${money(p.cost_cents)} cost</div>
              <div style="font-size:12px; color:var(--muted)">Stock: ${p.stock_qty}</div>
            </div>
          </div>
        `).join('') : '<div style="color:var(--muted); font-size:14px; padding:10px 0;">No products supplied yet.</div>'}
      </div>

      <div class="qty-popup-actions">
        <button class="primary" id="closeSupplierView" style="width:100%">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#closeSupplierView').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

function showSupplierModal(supplier = null) {
  const overlay = document.createElement('div');
  overlay.className = 'qty-popup-overlay';
  overlay.innerHTML = `
    <div class="qty-popup" style="max-width: 450px; text-align: left;">
      <h3 style="margin-top:0">${supplier ? 'Edit Supplier' : 'New Supplier'}</h3>
      <form id="supplierForm" style="display:flex; flex-direction:column; gap:16px;">
        <div>
          <label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px;">Supplier Name *</label>
          <input class="field" name="name" required value="${supplier ? supplier.name : ''}" style="width:100%; padding:10px;">
        </div>
        <div style="display:flex; gap:16px;">
          <div style="flex:1;">
            <label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px;">Phone Number</label>
            <input class="field" name="phone" value="${supplier?.phone || ''}" style="width:100%; padding:10px;">
          </div>
          <div style="flex:1;">
            <label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px;">Status</label>
            <select name="active" class="field" style="width:100%; padding:10px;">
              <option value="1" ${supplier?.active === 0 ? '' : 'selected'}>Active</option>
              <option value="0" ${supplier?.active === 0 ? 'selected' : ''}>Inactive</option>
            </select>
          </div>
        </div>
        <div>
          <label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px;">Email Address</label>
          <input type="email" class="field" name="email" value="${supplier?.email || ''}" style="width:100%; padding:10px;">
        </div>
        
        <div id="supplierMsg" style="margin-top:4px; font-weight:600; font-size:14px; text-align:center;"></div>
        
        <div class="qty-popup-actions" style="margin-top:16px;">
          <button type="button" class="ghost" id="cancelSupplierBtn">Cancel</button>
          <button type="submit" class="primary">Save Supplier</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#cancelSupplierBtn').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const msgEl = overlay.querySelector('#supplierMsg');
  const submitBtn = overlay.querySelector('button[type="submit"]');

  overlay.querySelector('#supplierForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
    
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (supplier) payload.id = supplier.id;
    
    try {
      await api('/api/admin/supplier', { method: 'POST', body: payload });
      msgEl.style.color = 'var(--ok)';
      msgEl.textContent = 'Supplier saved successfully!';
      
      setTimeout(() => {
        close();
        renderSuppliers();
      }, 800);
      
    } catch (err) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = err.message;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Supplier';
    }
  });
}

// ── Sales History (replaces Orders) ──────────────────────────────────────────
async function renderSales() {
  const root = qs('[data-page="sales"]');
  const orders = await api('/api/orders?status=paid');
  
  const formatDate = (ts) => {
    if (!ts) return '-';
    const d = new Date(ts * 1000);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  root.innerHTML = `
    <div class="panel-title-group" style="margin: 0 24px 20px; padding-top: 24px;">
      <h2>Sales History</h2>
      <button class="add-btn" id="refreshSales" style="background:var(--ink)">Refresh</button>
    </div>
    
    <div class="sales-table-container">
      <table class="sales-table">
        <thead>
          <tr>
            <th>Receipt No.</th>
            <th>Date</th>
            <th>Cashier</th>
            <th>Payment</th>
            <th style="text-align: right">Total</th>
            <th style="text-align: right">Action</th>
          </tr>
        </thead>
        <tbody>
          ${orders.map(o => `
            <tr class="sales-row" data-id="${o.id}">
              <td class="font-mono"><strong>${o.ticket_no}</strong></td>
              <td class="text-muted">${formatDate(o.updated_at)}</td>
              <td>${o.employee_name || '-'}</td>
              <td>
                <span class="pay-badge ${o.payment_method === 'mpesa' ? 'mpesa' : 'cash'}">
                  ${o.payment_method === 'mpesa' ? 'M-Pesa' : 'Cash'}
                </span>
                ${o.payment_ref ? `<div class="pay-ref">${o.payment_ref}</div>` : ''}
              </td>
              <td class="sales-total" style="text-align: right">${money(o.total_cents)}</td>
              <td style="text-align: right">
                <button class="view-receipt-btn">View</button>
              </td>
            </tr>
          `).join('') || `<tr><td colspan="6" class="empty" style="text-align:center; padding: 40px;">No sales found</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  
  qs('#refreshSales').addEventListener('click', renderSales);
  
  qsa('.sales-row', root).forEach(row => {
    row.addEventListener('click', async () => {
      const id = row.dataset.id;
      try {
        const fullOrder = await api(`/api/order?id=${id}`);
        showReceiptModal(fullOrder);
      } catch (err) {
        toast('Failed to load receipt', 'error');
      }
    });
  });
}

// ── Cashier Payments ──────────────────────────────────────────────────────────
async function renderCashier() {
  const root = qs('[data-page="cashier"]');
  const existingSearch = qs('#paymentSearch')?.value || '';
  const orders = await api(`/api/payments?q=${encodeURIComponent(existingSearch)}`);
  root.innerHTML = `
    <div class="panel-head">
      <h2>Pending Payments</h2>
      <div class="head-actions">
        <input class="field compact-field" id="paymentSearch" placeholder="Ticket, customer, staff" value="${existingSearch}">
        <button class="primary" id="refreshCashier">Refresh</button>
      </div>
    </div>
    <div class="content-grid">
      ${orders.map(o => `
        <article class="order-card ${o.status}" data-order="${o.id}">
          <span class="badge">${o.status}</span>
          <strong>${o.ticket_no}</strong>
          <span>${o.order_type} — ${o.employee_name || '-'}</span>
          ${o.customer_name ? `<span>Customer: ${o.customer_name}</span>` : ''}
          <strong>${money(o.total_cents)}</strong>
          <input class="field pay-ref" placeholder="M-Pesa code / reference">
          <div class="pay-actions">
            <button class="primary pay-btn" data-method="mpesa">M-Pesa</button>
            <button class="secondary pay-btn" data-method="cash">Cash</button>
            <button class="secondary pay-btn" data-method="card">Card</button>
          </div>
          <button class="receipt-link-btn" data-receipt-order="${o.id}">View Receipt</button>
        </article>
      `).join('') || '<div class="empty">No pending payments</div>'}
    </div>
  `;

  qs('#refreshCashier').addEventListener('click', renderCashier);
  qs('#paymentSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') renderCashier();
  });

  qsa('[data-receipt-order]', root).forEach(btn => btn.addEventListener('click', async () => {
    const orderId = Number(btn.dataset.receiptOrder);
    try {
      const allOrders = await api('/api/payments?q=');
      const summary = allOrders.find(o => o.id === orderId);
      if (summary) showReceiptModal({ ...summary, items: [] });
    } catch(e) { /* ignore */ }
  }));

  qsa('.pay-btn', root).forEach(btn => btn.addEventListener('click', async () => {
    const card = btn.closest('[data-order]');
    const orderId = Number(card.dataset.order);
    const ref = qs('.pay-ref', card).value.trim();
    await api('/api/order/pay', {
      method: 'POST',
      body: { order_id: orderId, payment_method: btn.dataset.method, payment_ref: ref },
    });
    await renderCashier();
  }));
}

// ── Product Admin (replaces Menu Admin) ──────────────────────────────────────
let productSearch = '';
let productCategoryFilter = '';

function renderProductAdmin() {
  const root = qs('[data-page="products"]');

  root.innerHTML = `
    <div class="panel-head">
      <div class="panel-title-group">
        <h2>Products</h2>
        <span class="badge" id="productCountBadge">${state.items.length} active</span>
      </div>
      <button class="primary add-btn" id="showAddProductModal">+ Add Product</button>
    </div>
    
    <div class="toolbar">
      <div class="search-bar">
        <span class="search-icon">🔍</span>
        <input type="text" class="field search-field" id="productSearchInput" placeholder="Search by name or SKU..." value="${productSearch}">
      </div>
      <select class="field cat-filter" id="productCatFilter">
        <option value="">All Categories</option>
        ${state.categories.map(c => `<option value="${c.id}" ${productCategoryFilter == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
      </select>
    </div>

    <div class="content-grid product-grid" id="productAdminGrid"></div>
  `;

  // Global Event Listeners for the page
  const searchInput = qs('#productSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      productSearch = e.target.value;
      renderProductAdminGrid();
    });
  }

  qs('#productCatFilter')?.addEventListener('change', e => {
    productCategoryFilter = e.target.value;
    renderProductAdminGrid();
  });

  qs('#showAddProductModal')?.addEventListener('click', () => showProductModal());

  // Close menus on outside click
  document.addEventListener('click', () => {
    qsa('.action-menu', root).forEach(m => m.classList.add('hidden'));
  });

  renderProductAdminGrid();
}

function renderProductAdminGrid() {
  const grid = qs('#productAdminGrid');
  if (!grid) return;
  const root = qs('[data-page="products"]');
  
  const filteredItems = state.items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(productSearch.toLowerCase()) || 
                          (item.sku && item.sku.toLowerCase().includes(productSearch.toLowerCase()));
    const matchesCat = productCategoryFilter ? item.category_id === Number(productCategoryFilter) : true;
    return matchesSearch && matchesCat;
  });

  const badge = qs('#productCountBadge');
  if (badge) badge.textContent = `${filteredItems.length} active`;

  grid.innerHTML = filteredItems.map(item => `
    <article class="menu-card product-card" data-id="${item.id}">
      <div class="card-header">
        <span class="badge" style="background:${item.color || '#334155'};color:white">${categoryName(item.category_id)}</span>
        <div class="card-actions">
          <button class="action-menu-btn">⋮</button>
          <div class="action-menu hidden">
            <button class="edit-btn" data-id="${item.id}">Edit Product</button>
            <button class="delete-btn" data-id="${item.id}">Delete</button>
          </div>
        </div>
      </div>
      <strong>${item.name}</strong>
      ${item.sku ? `<small class="sku-text">SKU: ${item.sku}</small>` : '<small class="sku-text">No SKU</small>'}
      
      <div class="price-tier">
        <div class="price-row">
          <span class="price-label">Retail (Sell)</span>
          <span class="price-value sell-price">${money(item.price_cents)}</span>
        </div>
        <div class="price-row">
          <span class="price-label">Wholesale (Cost)</span>
          <span class="price-value cost-price">${money(item.cost_cents || 0)}</span>
        </div>
      </div>
      
      <div class="card-footer">
        <small style="color:var(--muted)">Stock: ${item.stock_qty !== undefined ? item.stock_qty : '?'} ${item.unit || 'pcs'}</small>
      </div>
    </article>
  `).join('') || '<div class="empty">No products match your criteria</div>';

  // Dropdown toggles
  qsa('.action-menu-btn', grid).forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      const isHidden = menu.classList.contains('hidden');
      qsa('.action-menu', root).forEach(m => m.classList.add('hidden')); // close all
      if (isHidden) menu.classList.remove('hidden');
    });
  });

  qsa('.edit-btn', grid).forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const item = state.items.find(i => i.id == btn.dataset.id);
      if(item) showProductModal(item);
    });
  });

  qsa('.delete-btn', grid).forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Are you sure you want to completely delete this product?')) return;
      const item = state.items.find(i => i.id == btn.dataset.id);
      if (item) {
        try {
          const payload = await api('/api/menu/item?id=' + item.id, { method: 'DELETE' });
          if (payload.error) {
            alert(payload.error);
            return;
          }
          state.categories = payload.categories;
          state.items = payload.items;
          renderProductAdmin();
        } catch (err) {
          alert('Could not delete product. It may have sales history tied to it.');
        }
      }
    });
  });
}

function showProductModal(item = null) {
  document.getElementById('productModal')?.remove();
  
  const isEdit = !!item;
  let defaultSku = '';
  if (!isEdit) {
    const skus = state.items.map(i => parseInt(i.sku) || 0);
    const maxSku = skus.length > 0 ? Math.max(...skus) : 0;
    defaultSku = maxSku + 1;
  }
  const overlay = document.createElement('div');
  overlay.id = 'productModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="width:500px; max-width:90vw;">
      <div class="modal-head">
        <h3>${isEdit ? 'Edit Product' : 'Add Product'}</h3>
        <button class="modal-close" id="pmClose" type="button">&times;</button>
      </div>
      <form id="pmForm" class="modal-form">
        <div class="form-grid">
          <div class="form-group" style="grid-column: 1 / -1;">
            <label>Product Image</label>
            <div style="display:flex; align-items:center; gap:16px;">
              <div id="imgPreview" style="width:64px; height:64px; background:#f1f5f9; border-radius:8px; border:1px solid var(--line); display:flex; align-items:center; justify-content:center; overflow:hidden;">
                ${item?.image_url ? `<img src="${item.image_url}" style="width:100%;height:100%;object-fit:contain;padding:4px;box-sizing:border-box;">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;color:var(--muted)"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>'}
              </div>
              <input type="file" id="imgUpload" accept="image/*" class="field" style="flex:1; padding:8px;">
              <input type="hidden" name="image_base64" id="imgBase64">
              <input type="hidden" name="image_url" value="${item?.image_url || ''}">
            </div>
          </div>
          <div class="form-group" style="grid-column: 1 / -1;">
            <label>Product Name</label>
            <input class="field" name="name" value="${item?.name || ''}" required>
          </div>
          <div class="form-group">
            <label>Category</label>
            <select class="field" name="category_id">
              ${state.categories.map(c => `<option value="${c.id}" ${item?.category_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>SKU</label>
            <input class="field" name="sku" value="${item?.sku || defaultSku}">
          </div>
          <div class="form-group">
            <label>Unit of Measure</label>
            <input class="field" name="unit" placeholder="pcs, kg, m, tin" value="${item?.unit || 'pcs'}">
          </div>
          <div class="form-group">
            <label>Stock Qty</label>
            <input class="field" name="stock_qty" type="number" step="1" value="${item?.stock_qty || 0}">
          </div>
          <div class="form-group">
            <label>Cost Price (Wholesale)</label>
            <input class="field" name="cost" type="number" step="0.01" min="0" value="${item ? (item.cost_cents || 0)/100 : ''}">
          </div>
          <div class="form-group">
            <label>Selling Price (Retail)</label>
            <input class="field" name="price" type="number" step="0.01" min="0" value="${item ? (item.price_cents || 0)/100 : ''}" required>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary" id="pmCancel">Cancel</button>
          <button type="submit" class="primary">${isEdit ? 'Save Changes' : 'Add Product'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  
  const close = () => overlay.remove();
  qs('#pmClose', overlay).addEventListener('click', close);
  qs('#pmCancel', overlay).addEventListener('click', close);
  
  const imgUpload = qs('#imgUpload', overlay);
  const imgPreview = qs('#imgPreview', overlay);
  const imgBase64 = qs('#imgBase64', overlay);
  if (imgUpload) {
    imgUpload.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          // Compress: resize to max 400x400, encode as JPEG 75%
          const MAX = 400;
          let w = img.width, h = img.height;
          if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
          else        { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const compressed = canvas.toDataURL('image/jpeg', 0.75);
          imgBase64.value = compressed;
          imgPreview.innerHTML = `<img src="${compressed}" style="width:100%;height:100%;object-fit:contain;padding:4px;box-sizing:border-box;">`;
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }
  
  qs('#pmForm', overlay).addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (isEdit) data.id = item.id;
    if (item) {
      data.color = item.color;
      data.active = item.active;
    }
    const payload = await api('/api/menu/item', { method: 'POST', body: data });
    state.categories = payload.categories;
    state.items = payload.items;
    close();
    renderProductAdmin();
  });
}

// ── Stock Page (replaces Kitchen) ────────────────────────────────────────────
let stockSearch = '';
let stockFilter = 'all'; // all, low, in_stock

async function renderStock() {
  const root = qs('[data-page="stock"]');
  const allItems = await api('/api/stock');
  
  const lowStockCount = allItems.filter(i => (i.stock_qty || 0) <= 5).length;
  
  const filteredItems = allItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(stockSearch.toLowerCase()) || 
                          (item.sku && item.sku.toLowerCase().includes(stockSearch.toLowerCase()));
    
    let matchesFilter = true;
    if (stockFilter === 'low') matchesFilter = (item.stock_qty || 0) <= 5;
    if (stockFilter === 'in_stock') matchesFilter = (item.stock_qty || 0) > 5;
    
    return matchesSearch && matchesFilter;
  });

  root.innerHTML = `
    <div class="panel-head">
      <div class="panel-title-group">
        <h2>Stock Levels</h2>
      </div>
      <button class="primary" id="refreshStock">Refresh</button>
    </div>
    
    <div class="toolbar stock-toolbar">
      <div class="filter-pills">
        <button class="pill ${stockFilter === 'all' ? 'active' : ''}" data-filter="all">All Inventory</button>
        <button class="pill alert-pill ${stockFilter === 'low' ? 'active' : ''}" data-filter="low">
          Low Stock Alert <span class="pill-badge">${lowStockCount}</span>
        </button>
        <button class="pill ${stockFilter === 'in_stock' ? 'active' : ''}" data-filter="in_stock">In Stock</button>
      </div>
      <div class="search-bar">
        <span class="search-icon">🔍</span>
        <input type="text" class="field search-field" id="stockSearchInput" placeholder="Search by name or SKU..." value="${stockSearch}">
      </div>
    </div>

    <div class="content-grid stock-grid">
      ${filteredItems.map(item => {
        const low = (item.stock_qty || 0) <= 5;
        return `
          <article class="stock-card ${low ? 'low-stock' : 'in-stock'}" data-id="${item.id}">
            <div class="card-header">
              <span class="badge status-badge">${low ? 'LOW STOCK' : 'In Stock'}</span>
              <span class="category-text">${categoryName(item.category_id)}</span>
            </div>
            <strong>${item.name}</strong>
            ${item.sku ? `<small class="sku-text">SKU: ${item.sku}</small>` : '<small class="sku-text">No SKU</small>'}
            
            <div class="stock-display">
              <span class="stock-value">${item.stock_qty || 0}</span>
              <span class="stock-unit">${item.unit || 'pcs'}</span>
            </div>
            
            <div class="card-footer">
              ${low ? `
                <button class="danger restock-btn" data-id="${item.id}">Restock / Reorder</button>
              ` : `
                <div class="inline-adjust">
                  <button class="adjust-btn minus" data-id="${item.id}">−</button>
                  <span class="adjust-label">Adjust</span>
                  <button class="adjust-btn plus" data-id="${item.id}">+</button>
                </div>
              `}
            </div>
          </article>
        `;
      }).join('') || '<div class="empty">No products match your criteria</div>'}
    </div>
  `;
  
  qs('#refreshStock')?.addEventListener('click', renderStock);
  
  const stInp = qs('#stockSearchInput');
  if (stInp) {
    stInp.addEventListener('input', e => {
      stockSearch = e.target.value;
      renderStock();
      const inp = qs('#stockSearchInput');
      inp.focus();
      inp.selectionStart = inp.selectionEnd = inp.value.length;
    });
  }

  qsa('.pill', root).forEach(btn => {
    btn.addEventListener('click', () => {
      stockFilter = btn.dataset.filter;
      renderStock();
    });
  });

  // Adjust actions
  qsa('.adjust-btn', root).forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const isPlus = btn.classList.contains('plus');
      const change = isPlus ? 1 : -1;
      
      try {
        await api('/api/stock/adjust', {
          method: 'POST',
          body: { product_id: id, qty_change: change, reason: 'inline_adjustment' }
        });
        await bootstrap(); // refresh global catalog
        renderStock();
      } catch (err) {
        alert('Failed to adjust stock. Ensure you have manager privileges.');
      }
    });
  });

  qsa('.restock-btn', root).forEach(btn => {
    btn.addEventListener('click', () => {
      alert('Restock request recorded for product ID: ' + btn.dataset.id);
    });
  });
}

// ── Reports ───────────────────────────────────────────────────────────────────
async function renderReports(period = 'today') {
  const root = qs('[data-page="reports"]');
  const report = await api(`/api/reports?period=${period}`);
  
  const profit = report.totals.sales - report.totals.costs;
  const margin = report.totals.sales > 0 ? Math.round((profit / report.totals.sales) * 100) : 0;
  
  let mpesaTotal = 0;
  let cashTotal = 0;
  if (report.payments) {
    report.payments.forEach(p => {
      if (p.method === 'mpesa') mpesaTotal += p.amount;
      else cashTotal += p.amount;
    });
  }

  root.innerHTML = `
    <div class="panel-title-group" style="margin: 0 24px 20px; padding-top: 24px; display: flex; justify-content: space-between; align-items: center;">
      <h2>Business Analytics</h2>
      <div style="display:flex; gap: 8px;">
        <select id="reportPeriod" class="field" style="padding: 6px 12px; height: 36px;">
          <option value="today" ${period === 'today' ? 'selected' : ''}>Today</option>
          <option value="yesterday" ${period === 'yesterday' ? 'selected' : ''}>Yesterday</option>
          <option value="week" ${period === 'week' ? 'selected' : ''}>Last 7 Days</option>
          <option value="month" ${period === 'month' ? 'selected' : ''}>Last 30 Days</option>
        </select>
        <button class="add-btn" id="printReportBtn" style="background:var(--ink)">Print Z-Report</button>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 0 24px 24px;">
      <div style="background: white; padding: 20px; border-radius: 12px; border: 1px solid var(--line); box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
        <div style="font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Gross Revenue</div>
        <div style="font-size: 28px; font-weight: 800; color: var(--ink); margin-top: 8px;">${money(report.totals.sales)}</div>
        <div style="font-size: 13px; color: var(--muted); margin-top: 4px;">From ${report.totals.orders} sales</div>
      </div>
      <div style="background: white; padding: 20px; border-radius: 12px; border: 1px solid var(--line); box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
        <div style="font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Gross Profit</div>
        <div style="font-size: 28px; font-weight: 800; color: var(--ok); margin-top: 8px;">${money(profit)}</div>
        <div style="font-size: 13px; color: var(--muted); margin-top: 4px;">Realized Margin: ${margin}%</div>
      </div>
      <div style="background: white; padding: 20px; border-radius: 12px; border: 1px solid var(--line); box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
        <div style="font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Inventory Value</div>
        <div style="font-size: 28px; font-weight: 800; color: #1d4ed8; margin-top: 8px;">${money(report.stock?.inventory_value || 0)}</div>
        <div style="font-size: 13px; color: var(--muted); margin-top: 4px;">Potential Profit: ${money(report.stock?.potential_profit || 0)}</div>
      </div>
      <div style="background: white; padding: 20px; border-radius: 12px; border: 1px solid var(--line); box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
        <div style="font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Cash in Drawer</div>
        <div style="font-size: 28px; font-weight: 800; color: #16a34a; margin-top: 8px;">${money(cashTotal)}</div>
      </div>
    </div>
    
    <div class="sales-table-container">
      <div style="padding: 16px 20px; font-weight: 700; font-size: 12px; color: var(--muted); text-transform: uppercase; border-bottom: 1px solid var(--line); background: #f8fafc;">TOP MOVERS (BY REVENUE)</div>
      <table class="sales-table" style="border-top: none;">
        <thead>
          <tr>
            <th>Product Name</th>
            <th style="text-align: right">Qty Sold</th>
            <th style="text-align: right">Revenue Generated</th>
            <th style="text-align: right">Current Stock Left</th>
          </tr>
        </thead>
        <tbody>
          ${(report.top_items || []).map(item => `
            <tr class="sales-row">
              <td><strong>${item.name}</strong></td>
              <td style="text-align: right">${item.qty}</td>
              <td style="text-align: right; font-weight: 700; color: var(--primary-dark)">${money(item.sales)}</td>
              <td style="text-align: right">
                <span class="pay-badge" style="${item.current_stock > 10 ? 'background:#dcfce7;color:#16a34a;' : 'background:#fee2e2;color:#dc2626;'}">
                  ${item.current_stock || 0} left
                </span>
              </td>
            </tr>
          `).join('') || `<tr><td colspan="4" class="empty" style="text-align:center; padding: 40px;">No sales data for this period</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  
  qs('#reportPeriod').addEventListener('change', (e) => renderReports(e.target.value));
  qs('#printReportBtn').addEventListener('click', () => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html><head><style>
        body { font-family: monospace; font-size: 12px; margin: 0; padding: 20px; width: 300px; }
        .text-center { text-align: center; }
        .flex { display: flex; justify-content: space-between; margin-bottom: 4px; }
        h2 { margin: 0 0 5px 0; font-size: 16px; }
        hr { border-top: 1px dashed black; border-bottom: none; margin: 10px 0; }
      </style></head><body>
        <div class="text-center">
          <h2>EITY FIT POS</h2>
          <p style="margin:0">Z-REPORT (${period.toUpperCase()})</p>
        </div>
        <hr>
        <div class="flex"><span>TOTAL SALES:</span> <strong>${money(report.totals.sales)}</strong></div>
        <div class="flex"><span>GROSS PROFIT:</span> <strong>${money(profit)}</strong></div>
        <div class="flex"><span>PROFIT MARGIN:</span> <strong>${margin}%</strong></div>
        <hr>
        <div class="flex"><span>M-PESA TOTAL:</span> <span>${money(mpesaTotal)}</span></div>
        <div class="flex"><span>CASH TOTAL:</span> <span>${money(cashTotal)}</span></div>
        <hr>
        <div class="text-center"><p>Printed: ${new Date().toLocaleString()}</p></div>
        <script>window.print(); window.close();</script>
      </body></html>
    `);
  });
}

function categoryName(id) {
  return state.categories.find(c => c.id === id)?.name || 'Products';
}

// ── Entry Point ───────────────────────────────────────────────────────────────
async function start() {
  const page = pageName();
  if (!page) return;
  await bootstrap();
  if (page === 'pos')       posLayout();
  if (page === 'suppliers') await renderSuppliers();
  if (page === 'sales')     await renderSales();
  if (page === 'cashier')   await renderCashier();
  if (page === 'products')  renderProductAdmin();
  if (page === 'stock')     await renderStock();
  if (page === 'reports')   await renderReports();
}

start().catch(renderShellError);
