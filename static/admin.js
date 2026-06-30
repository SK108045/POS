const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = c => `KES ${(c/100).toLocaleString('en-KE', {minimumFractionDigits:2})}`;
const fmt = n => Number(n).toLocaleString('en-KE');

// ── STATE ──
let state = { user: null, summary: null, users: [], suppliers: [], menu: null };

// ── API ──
async function api(path, opts = {}) {
  const init = { headers: {'Content-Type':'application/json'}, ...opts };
  if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
  const res = await fetch(path, init);
  if (res.status === 401) { location.href = '/admin'; return null; }
  if (res.status === 403) { location.href = '/admin'; return null; }
  if (!res.ok) { const e = await res.json().catch(()=>({error:'Unknown error'})); throw new Error(e.error || res.status); }
  return res.json();
}

// ── TOAST ──
function toast(msg, type = 'success') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||'•'}</span><span>${msg}</span>`;
  $('#toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── MODAL ──
function openModal(html, onOpen) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box">${html}</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  if (onOpen) onOpen(overlay);
  return overlay;
}

// ── NAV ──
function navigate(section) {
  if (section === 'pos') { location.href = '/pos'; return; }
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.section === section));
  $$('.content-section').forEach(el => el.classList.toggle('active', el.id === `sec-${section}`));
  if (section === 'dashboard') renderDashboard();
  if (section === 'users') renderUsers();
  if (section === 'menu') renderMenu();
  if (section === 'suppliers') renderSuppliers();
  if (section === 'customers') renderCustomers();
  if (section === 'stock') renderStockAdmin();
}

// ── DASHBOARD ──
async function renderDashboard() {
  const sec = $('#sec-dashboard');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading analytics…</div>`;
  try {
    state.summary = await api('/api/admin/summary');
    buildDashboard(state.summary);
  } catch(e) { sec.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>${e.message}</p></div>`; }
}

function generateLineChart(data) {
  if (!data || data.length === 0) return '<div class="empty-state"><p>No sales data yet</p></div>';
  const width = 800;
  const height = 150;
  const padding = 20;
  const maxVal = Math.max(...data.map(d => d.sales), 1);
  const minVal = 0;
  
  const stepX = (width - padding * 2) / Math.max(data.length - 1, 1);
  
  const points = data.map((d, i) => {
    const x = padding + i * stepX;
    const y = height - padding - ((d.sales - minVal) / (maxVal - minVal)) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');
  
  const areaPath = `M ${padding},${height - padding} L ${points} L ${padding + (data.length - 1) * stepX},${height - padding} Z`;
  
  const labels = data.map((d, i) => {
    const x = padding + i * stepX;
    const date = new Date(d.day).toLocaleDateString('en-US', {weekday:'short'});
    return `<text x="${x}" y="${height - 2}" font-size="10" fill="var(--muted)" text-anchor="middle">${date}</text>`;
  }).join('');
  
  const circles = data.map((d, i) => {
    const x = padding + i * stepX;
    const y = height - padding - ((d.sales - minVal) / (maxVal - minVal)) * (height - padding * 2);
    return `<circle cx="${x}" cy="${y}" r="4" fill="white" stroke="var(--primary)" stroke-width="2"><title>${d.day}: ${money(d.sales)}</title></circle>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; overflow:visible; display:block">
      <defs>
        <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.3" />
          <stop offset="100%" stop-color="var(--primary)" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#chartGradient)" />
      <polyline points="${points}" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      ${circles}
      ${labels}
    </svg>
  `;
}

function buildDashboard(s) {
  const t = s.totals, c = s.counts;
  const sec = $('#sec-dashboard');
  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Dashboard</h1>
        <p>Live business overview for BuildMart Retail POS</p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="renderDashboard()">Refresh</button>
    </div>

    <div class="stats-grid">
      <div class="stat-card primary">
        <div class="stat-label">Today's Sales</div>
        <div class="stat-value">${money(t.sales_today)}</div>
        <div class="stat-sub">${fmt(t.paid_today)} paid orders</div>
      </div>
      <div class="stat-card success">
        <div class="stat-label">Week Revenue</div>
        <div class="stat-value">${money(t.sales_week)}</div>
        <div class="stat-sub">Last 7 days</div>
      </div>
      <div class="stat-card warn">
        <div class="stat-label">Unpaid Orders</div>
        <div class="stat-value">${fmt(t.unpaid_orders)}</div>
        <div class="stat-sub">${money(t.unpaid_total)} outstanding</div>
      </div>
      <div class="stat-card info">
        <div class="stat-label">Active Staff</div>
        <div class="stat-value">${fmt(c.active_users)}</div>
        <div class="stat-sub">${fmt(c.active_users)} users · ${fmt(c.active_items)} products · ${fmt(c.active_suppliers)} suppliers</div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px">
      <div class="panel-header">
        <div>
          <div class="panel-title">Revenue Trend</div>
          <div class="panel-subtitle">Daily sales over the last 7 days</div>
        </div>
      </div>
      <div class="panel-body" style="padding-top:20px; padding-bottom:10px;">
        ${generateLineChart(s.sales_trend)}
      </div>
    </div>

    <div class="two-col">
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Top Selling Items</div>
            <div class="panel-subtitle">By revenue — last 7 days</div>
          </div>
        </div>
        <div class="panel-body" id="topItemsArea"></div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Staff Performance</div>
            <div class="panel-subtitle">Sales by employee — last 7 days</div>
          </div>
        </div>
        <div class="panel-body" id="employeeArea"></div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px">
      <div class="panel-header">
        <div>
          <div class="panel-title">Payment Methods</div>
          <div class="panel-subtitle">Last 7 days breakdown</div>
        </div>
      </div>
      <div class="panel-body" id="methodArea"></div>
    </div>
  `;

  // Top items chart
  const maxSales = Math.max(...s.top_items.map(i=>i.sales), 1);
  $('#topItemsArea').innerHTML = s.top_items.length ? `
    <div class="chart-area" id="barChart"></div>
    <div style="display:flex;justify-content:space-between;margin-top:8px;gap:4px">
      ${s.top_items.map(i=>`<div style="flex:1;text-align:center;font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.name}</div>`).join('')}
    </div>
  ` : `<div class="empty-state"><p>No sales data yet</p></div>`;

  if (s.top_items.length) {
    const chart = $('#barChart');
    chart.innerHTML = s.top_items.map(i => {
      const pct = Math.round((i.sales / maxSales) * 100);
      return `
        <div class="chart-bar-wrap" title="${i.name}: ${money(i.sales)} (${i.qty} sold)">
          <div class="chart-bar" style="height:${Math.max(pct,4)}%"></div>
        </div>`;
    }).join('');
  }

  // Employees leaderboard
  $('#employeeArea').innerHTML = s.by_employee.length ? s.by_employee.map((e,i)=>`
    <div class="leaderboard-row">
      <div class="leaderboard-rank ${i===0?'gold':''}">${i+1}</div>
      <div>
        <div class="leaderboard-name">${e.employee}</div>
        <div class="leaderboard-sub">${fmt(e.orders)} orders</div>
      </div>
      <div class="leaderboard-val">${money(e.sales)}</div>
    </div>
  `).join('') : `<div class="empty-state"><p>No employee sales yet</p></div>`;

  // Payment methods
  const maxMethod = Math.max(...s.by_method.map(m=>m.sales), 1);
  $('#methodArea').innerHTML = s.by_method.length ? `<div class="method-grid">${s.by_method.map(m=>`
    <div class="method-row">
      <div class="method-label">${m.method}</div>
      <div class="method-bar-track">
        <div class="method-bar-fill" style="width:${Math.round(m.sales/maxMethod*100)}%"></div>
      </div>
      <div class="method-val">${money(m.sales)}</div>
    </div>
  `).join('')}</div>` : `<div class="empty-state"><p>No payment data yet</p></div>`;
}

// ── USERS ──
async function renderUsers() {
  const sec = $('#sec-users');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading…</div>`;
  try {
    state.users = await api('/api/admin/users');
    buildUsers();
  } catch(e) { sec.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
}

function buildUsers() {
  const roleBadge = r => `<span class="badge badge-${r}">${r}</span>`;
  const sec = $('#sec-users');
  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Staff Management</h1>
        <p>${state.users.length} total accounts</p>
      </div>
      <button class="btn btn-primary" id="addUserBtn">Add Staff</button>
    </div>
    <div class="toolbar">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input class="form-input" id="userSearch" placeholder="Search name or username…">
      </div>
      <select class="form-select" id="roleFilter" style="width:140px">
        <option value="">All Roles</option>
        <option value="manager">Manager</option>
        <option value="cashier">Cashier</option>
        <option value="staff">Staff</option>
      </select>
    </div>
    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="userTableBody"></tbody>
      </table>
    </div>
  `;
  const renderRows = (filter='', role='') => {
    const rows = state.users.filter(u =>
      (!filter || u.full_name.toLowerCase().includes(filter) || u.username.toLowerCase().includes(filter)) &&
      (!role || u.role === role)
    );
    $('#userTableBody').innerHTML = rows.length ? rows.map(u=>`
      <tr>
        <td><strong>${u.full_name}</strong></td>
        <td style="color:var(--muted);font-family:monospace">${u.username}</td>
        <td>${roleBadge(u.role)}</td>
        <td><span class="badge badge-${u.active?'active':'inactive'}">${u.active?'Active':'Inactive'}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="editUser(${u.id})">Edit</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="5"><div class="empty-state"><p>No staff found</p></div></td></tr>`;
  };
  renderRows();
  $('#userSearch').addEventListener('input', e => renderRows(e.target.value.toLowerCase(), $('#roleFilter').value));
  $('#roleFilter').addEventListener('change', e => renderRows($('#userSearch').value.toLowerCase(), e.target.value));
  $('#addUserBtn').addEventListener('click', () => openUserModal(null));
}

function editUser(id) {
  const u = state.users.find(x => x.id === id);
  if (u) openUserModal(u);
}

function openUserModal(user) {
  const isNew = !user;
  const overlay = openModal(`
    <div class="modal-header">
      <div class="modal-title">${isNew ? 'Add Staff Member' : 'Edit Staff'}</div>
      <button class="modal-close" id="modalClose">✕</button>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Full Name</label>
        <input class="form-input" id="mFullName" value="${user?.full_name||''}" placeholder="e.g. Jane Mwangi" required>
      </div>
      <div class="form-group">
        <label class="form-label">Username</label>
        <input class="form-input" id="mUsername" value="${user?.username||''}" placeholder="e.g. waiter7" required>
      </div>
      <div class="form-group">
        <label class="form-label">Role</label>
        <select class="form-select" id="mRole">
          <option value="staff" ${user?.role==='staff'?'selected':''}>Staff</option>
          <option value="cashier" ${user?.role==='cashier'?'selected':''}>Cashier</option>
          <option value="manager" ${user?.role==='manager'?'selected':''}>Manager</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-select" id="mActive">
          <option value="1" ${(!user||user.active)?'selected':''}>Active</option>
          <option value="0" ${user&&!user.active?'selected':''}>Inactive</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">${isNew ? 'Password / PIN' : 'New Password (leave blank to keep)'}</label>
        <input class="form-input" id="mPassword" type="password" placeholder="${isNew?'Default: 1234 or admin123':'Leave blank to keep current'}">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="mCancel">Cancel</button>
      <button class="btn btn-primary" id="mSave">Save</button>
    </div>
  `);
  overlay.querySelector('#modalClose').onclick = () => overlay.remove();
  overlay.querySelector('#mCancel').onclick = () => overlay.remove();
  overlay.querySelector('#mSave').onclick = async () => {
    const payload = {
      full_name: overlay.querySelector('#mFullName').value.trim(),
      username: overlay.querySelector('#mUsername').value.trim(),
      role: overlay.querySelector('#mRole').value,
      active: overlay.querySelector('#mActive').value,
      password: overlay.querySelector('#mPassword').value,
    };
    if (user) payload.id = user.id;
    try {
      state.users = await api('/api/admin/user', { method: 'POST', body: payload });
      toast(`Staff ${isNew ? 'added' : 'updated'} successfully`);
      overlay.remove();
      buildUsers();
    } catch(e) { toast(e.message, 'error'); }
  };
}

// ── MENU ──
async function renderMenu() {
  const sec = $('#sec-menu');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading…</div>`;
  try {
    state.menu = await api('/api/menu');
    buildMenu();
  } catch(e) { sec.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
}

function buildMenu() {
  const cats = state.menu.categories;
  const items = state.menu.items;
  const catName = id => cats.find(c=>c.id===id)?.name || '?';
  const sec = $('#sec-menu');
  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Products</h1>
        <p>${items.length} active products across ${cats.length} categories</p>
      </div>
      <button class="btn btn-primary" id="addItemBtn">Add Product</button>
    </div>
    <div class="toolbar">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input class="form-input" id="menuSearch" placeholder="Search products or SKU…">
      </div>
      <select class="form-select" id="catFilter" style="width:160px">
        <option value="">All Categories</option>
        ${cats.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}
      </select>
    </div>
    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Category</th>
            <th>SKU</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="menuTableBody"></tbody>
      </table>
    </div>
  `;
  const renderRows = (filter='', catId='') => {
    const filtered = items.filter(i =>
      (!filter || i.name.toLowerCase().includes(filter) || (i.sku||'').toLowerCase().includes(filter)) &&
      (!catId || i.category_id === Number(catId))
    );
    $('#menuTableBody').innerHTML = filtered.length ? filtered.map(i=>`
      <tr>
        <td>
          <span class="color-swatch" style="background:${i.color}"></span>
          <strong>${i.name}</strong>
        </td>
        <td style="color:var(--muted)">${catName(i.category_id)}</td>
        <td style="color:var(--muted);font-family:monospace">${i.sku||'—'}</td>
        <td style="font-weight:700">${money(i.price_cents)}</td>
        <td><span class="badge" style="${(i.stock_qty||0)<=5?'background:#fee2e2;color:#dc2626':'background:#dcfce7;color:#16a34a'}">${i.stock_qty||0} ${i.unit||'pcs'}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="editItem(${i.id})">Edit</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="6"><div class="empty-state"><p>No products found</p></div></td></tr>`;
  };
  renderRows();
  $('#menuSearch').addEventListener('input', e => renderRows(e.target.value.toLowerCase(), $('#catFilter').value));
  $('#catFilter').addEventListener('change', e => renderRows($('#menuSearch').value.toLowerCase(), e.target.value));
  $('#addItemBtn').addEventListener('click', () => openItemModal(null));
}

function editItem(id) {
  const all = [...state.menu.items];
  const item = all.find(i => i.id === id);
  if (item) openItemModal(item);
}

function openItemModal(item) {
  const cats = state.menu.categories;
  const isNew = !item;
  const overlay = openModal(`
    <div class="modal-header">
      <div class="modal-title">${isNew ? 'Add Product' : 'Edit Product'}</div>
      <button class="modal-close" id="modalClose">✕</button>
    </div>
    <div class="form-grid form-grid-2">
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Product Name</label>
        <input class="form-input" id="mName" value="${item?.name||''}" placeholder="e.g. 13A Socket" required>
      </div>
      <div class="form-group">
        <label class="form-label">Category</label>
        <select class="form-select" id="mCat">
          ${cats.map(c=>`<option value="${c.id}" ${item?.category_id===c.id?'selected':''}>${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">SKU</label>
        <input class="form-input" id="mSku" value="${item?.sku||''}" placeholder="e.g. EL-001">
      </div>
      <div class="form-group">
        <label class="form-label">Price (KES)</label>
        <input class="form-input" id="mPrice" type="number" min="0" step="1" value="${item?item.price_cents/100:''}" placeholder="e.g. 350">
      </div>
      <div class="form-group">
        <label class="form-label">Cost Price (KES)</label>
        <input class="form-input" id="mCost" type="number" min="0" step="1" value="${item?item.cost_cents/100:''}" placeholder="e.g. 200">
      </div>
      <div class="form-group">
        <label class="form-label">Unit</label>
        <input class="form-input" id="mUnit" value="${item?.unit||'pcs'}" placeholder="pcs / kg / m / box">
      </div>
      <div class="form-group">
        <label class="form-label">Barcode</label>
        <input class="form-input" id="mBarcode" value="${item?.barcode||''}" placeholder="Optional barcode">
      </div>
      <div class="form-group">
        <label class="form-label">Button Color</label>
        <input class="form-input" id="mColor" type="color" value="${item?.color||'#334155'}" style="height:44px;padding:4px 8px;cursor:pointer">
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-select" id="mActive">
          <option value="1" ${(!item||item.active)?'selected':''}>Active</option>
          <option value="0" ${item&&!item.active?'selected':''}>Hidden</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="mCancel">Cancel</button>
      <button class="btn btn-primary" id="mSave">Save Product</button>
    </div>
  `);
  overlay.querySelector('#modalClose').onclick = () => overlay.remove();
  overlay.querySelector('#mCancel').onclick = () => overlay.remove();
  overlay.querySelector('#mSave').onclick = async () => {
    const payload = {
      name: overlay.querySelector('#mName').value.trim(),
      category_id: overlay.querySelector('#mCat').value,
      price: overlay.querySelector('#mPrice').value,
      cost: overlay.querySelector('#mCost')?.value || '0',
      sku: overlay.querySelector('#mSku')?.value || '',
      barcode: overlay.querySelector('#mBarcode')?.value || '',
      unit: overlay.querySelector('#mUnit')?.value || 'pcs',
      color: overlay.querySelector('#mColor').value,
      active: overlay.querySelector('#mActive').value,
    };
    if (item) payload.id = item.id;
    try {
      const updated = await api('/api/menu/item', { method:'POST', body: payload });
      state.menu = updated;
      toast(`Item ${isNew?'added':'updated'} successfully`);
      overlay.remove();
      buildMenu();
    } catch(e) { toast(e.message, 'error'); }
  };
}

// ── SUPPLIERS (replaces TABLES) ──
async function renderSuppliers() {
  const sec = $('#sec-suppliers');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading…</div>`;
  try {
    state.suppliers = await api('/api/admin/suppliers');
    buildSuppliers();
  } catch(e) { sec.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
}

function buildSuppliers() {
  const sec = $('#sec-suppliers');
  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Suppliers</h1>
        <p>${state.suppliers.length} suppliers on record</p>
      </div>
      <button class="btn btn-primary" id="addSupplierBtn">Add Supplier</button>
    </div>
    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${state.suppliers.map(s=>`
            <tr>
              <td><strong>${s.name}</strong></td>
              <td style="color:var(--muted)">${s.phone||'—'}</td>
              <td style="color:var(--muted)">${s.email||'—'}</td>
              <td><span class="badge badge-${s.active?'active':'inactive'}">${s.active?'Active':'Disabled'}</span></td>
              <td>
                <button class="btn btn-ghost btn-sm" onclick="editSupplier(${s.id})">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  $('#addSupplierBtn').addEventListener('click', () => openSupplierModal(null));
}

function editSupplier(id) {
  const s = state.suppliers.find(x => x.id === id);
  if (s) openSupplierModal(s);
}

function openSupplierModal(supplier) {
  const isNew = !supplier;
  const overlay = openModal(`
    <div class="modal-header">
      <div class="modal-title">${isNew ? 'Add Supplier' : 'Edit Supplier'}</div>
      <button class="modal-close" id="modalClose">✕</button>
    </div>
    <div class="form-grid form-grid-2">
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Supplier Name</label>
        <input class="form-input" id="mName" value="${supplier?.name||''}" placeholder="e.g. Crown Paints Kenya">
      </div>
      <div class="form-group">
        <label class="form-label">Phone</label>
        <input class="form-input" id="mPhone" value="${supplier?.phone||''}" placeholder="+254 700 000 000">
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" id="mEmail" type="email" value="${supplier?.email||''}" placeholder="orders@supplier.com">
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Address</label>
        <input class="form-input" id="mAddress" value="${supplier?.address||''}" placeholder="Physical address">
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-select" id="mActive">
          <option value="1" ${(!supplier||supplier.active)?'selected':''}>Active</option>
          <option value="0" ${supplier&&!supplier.active?'selected':''}>Disabled</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="mCancel">Cancel</button>
      <button class="btn btn-primary" id="mSave">Save</button>
    </div>
  `);
  overlay.querySelector('#modalClose').onclick = () => overlay.remove();
  overlay.querySelector('#mCancel').onclick = () => overlay.remove();
  overlay.querySelector('#mSave').onclick = async () => {
    const payload = {
      name: overlay.querySelector('#mName').value.trim(),
      phone: overlay.querySelector('#mPhone').value.trim(),
      email: overlay.querySelector('#mEmail').value.trim(),
      address: overlay.querySelector('#mAddress').value.trim(),
      active: overlay.querySelector('#mActive').value,
    };
    if (supplier) payload.id = supplier.id;
    try {
      state.suppliers = await api('/api/admin/supplier', { method:'POST', body: payload });
      toast(`Supplier ${isNew?'added':'updated'}`);
      overlay.remove();
      buildSuppliers();
    } catch(e) { toast(e.message, 'error'); }
  };
}

// ── STOCK ADMIN ──
async function renderStockAdmin() {
  const sec = $('#sec-stock');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading…</div>`;
  try {
    const items = await api('/api/stock');
    buildStockAdmin(items);
  } catch(e) { sec.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
}

function buildStockAdmin(items) {
  const sec = $('#sec-stock');
  const low = items.filter(i => i.stock_qty <= 5);
  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Stock Management</h1>
        <p>${items.length} products · <span style="color:#dc2626">${low.length} low stock</span></p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="renderStockAdmin()">Refresh</button>
    </div>
    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU</th>
            <th>Stock</th>
            <th>Unit</th>
            <th>Adjust</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(i => {
            const isLow = i.stock_qty <= 5;
            return `
              <tr style="${isLow?'background:#fff5f5':''}}">
                <td><strong>${i.name}</strong></td>
                <td style="color:var(--muted);font-family:monospace">${i.sku||'—'}</td>
                <td><span class="badge" style="${isLow?'background:#fee2e2;color:#dc2626':'background:#dcfce7;color:#16a34a'}">${i.stock_qty}</span></td>
                <td style="color:var(--muted)">${i.unit}</td>
                <td>
                  <div style="display:flex;gap:6px;align-items:center">
                    <input type="number" class="form-input" id="adj_${i.id}" value="1" min="-9999" style="width:70px;padding:6px 8px">
                    <button class="btn btn-primary btn-sm" onclick="adjustStock(${i.id},'add')">+Add</button>
                    <button class="btn btn-ghost btn-sm" onclick="adjustStock(${i.id},'remove')">−Sub</button>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function adjustStock(productId, direction) {
  const inp = $(`#adj_${productId}`);
  const qty = Math.abs(parseInt(inp.value) || 1);
  const qty_change = direction === 'add' ? qty : -qty;
  try {
    await api('/api/stock/adjust', { method:'POST', body: { product_id: productId, qty_change, reason: 'manual' } });
    toast(`Stock ${direction === 'add' ? 'added' : 'removed'}: ${qty}`);
    renderStockAdmin();
  } catch(e) { toast(e.message, 'error'); }
}

// ── BOOT ──

// ── CUSTOMERS ──
async function renderCustomers() {
  const sec = $('#sec-customers');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading…</div>`;
  try {
    state.customers = await api('/api/admin/customers');
    buildCustomers();
  } catch(e) { sec.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
}

function buildCustomers() {
  const sec = $('#sec-customers');
  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Customers</h1>
        <p>${state.customers.length} customers registered</p>
      </div>
      <button class="btn btn-primary" id="addCustomerBtn">Add Customer</button>
    </div>
    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${state.customers.map(c=>`
            <tr>
              <td><strong>${c.name}</strong></td>
              <td style="color:var(--muted)">${c.phone||'—'}</td>
              <td style="color:var(--muted)">${c.email||'—'}</td>
              <td>
                <button class="btn btn-ghost btn-sm" onclick="editCustomer(${c.id})">Edit</button>
                <a class="btn btn-primary btn-sm" href="https://wa.me/${c.phone.replace(/\+/g,'').replace(/^0/, '254')}?text=Thank%20you%20for%20shopping%20at%20BuildMart%21%20We%20value%20your%20business." target="_blank" style="text-decoration:none; display:inline-block; margin-left:8px;">Send PR Message</a>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  $('#addCustomerBtn').addEventListener('click', () => openCustomerModal(null));
}

function editCustomer(id) {
  const c = state.customers.find(x => x.id === id);
  if (c) openCustomerModal(c);
}

function openCustomerModal(customer) {
  const isNew = !customer;
  const overlay = openModal(`
    <div class="modal-header">
      <div class="modal-title">${isNew ? 'Add Customer' : 'Edit Customer'}</div>
      <button class="modal-close" id="modalClose">✕</button>
    </div>
    <div class="form-grid form-grid-2">
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Customer Name</label>
        <input class="form-input" id="mName" value="${customer?.name||''}" placeholder="e.g. John Doe">
      </div>
      <div class="form-group">
        <label class="form-label">Phone</label>
        <input class="form-input" id="mPhone" value="${customer?.phone||''}" placeholder="e.g. 07... or +254...">
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" id="mEmail" type="email" value="${customer?.email||''}" placeholder="Optional">
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Notes</label>
        <input class="form-input" id="mNotes" value="${customer?.notes||''}" placeholder="Preferences, address, etc.">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="mCancel">Cancel</button>
      <button class="btn btn-primary" id="mSave">Save</button>
    </div>
  `);
  overlay.querySelector('#modalClose').onclick = () => overlay.remove();
  overlay.querySelector('#mCancel').onclick = () => overlay.remove();
  overlay.querySelector('#mSave').onclick = async () => {
    const payload = {
      name: overlay.querySelector('#mName').value.trim(),
      phone: overlay.querySelector('#mPhone').value.trim(),
      email: overlay.querySelector('#mEmail').value.trim(),
      notes: overlay.querySelector('#mNotes').value.trim(),
    };
    if (!payload.name) {
      toast('Customer Name is required', 'error');
      return;
    }
    if (customer) payload.id = customer.id;
    try {
      state.customers = await api('/api/admin/customer', { method:'POST', body: payload });
      toast(`Customer ${isNew?'added':'updated'} successfully`);
      overlay.remove();
      buildCustomers();
    } catch(e) { toast(e.message, 'error'); }
  };
}

// ── BOOT ──
async function boot() {
  const data = await api('/api/bootstrap');
  if (!data) return;
  state.user = data.user;
  if (state.user.role !== 'manager') { location.href = '/admin'; return; }
  // render user info in sidebar
  $('#userDisplayName').textContent = state.user.name;
  $('#userAvatarLetter').textContent = (state.user.name||'A')[0].toUpperCase();
  // nav wiring
  $$('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.section));
  });
  navigate('dashboard');
}

boot().catch(e => { console.error(e); });
