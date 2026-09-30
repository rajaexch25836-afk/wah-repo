(() => {
  const $ = (id) => document.getElementById(id);
  const state = { settings: {}, content: null, applications: [], earnSearch: '', earnFilter: 'all', products: [], orders: [], users: [], payment: null, userSearch: '', userFilter: 'all', editing: null, images: [], search: '', filter: 'all', orderSearch: '', orderFilter: 'all' };

  document.querySelectorAll('[data-icon]').forEach((el) => (el.innerHTML = ICONS[el.dataset.icon] || ''));

  // ---------- helpers ----------
  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      body: options.body instanceof FormData ? options.body : options.body && JSON.stringify(options.body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.includes('/login')) showLogin();
    if (res.status === 403 && data.mustChangePassword) showForce();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function toast(msg, isError = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error-toast', isError);
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 2500);
  }

  const money = (n) => `${state.settings.currency || 'Rs.'} ${Number(n).toLocaleString('en-PK')}`;

  // ---------- auth ----------
  const loginViews = ['loginForm', 'codeForm', 'forceForm'];
  function showLoginStep(id) {
    $('appView').hidden = true;
    $('loginView').hidden = false;
    loginViews.forEach((v) => ($(v).hidden = v !== id));
    $(id).querySelector('input')?.focus();
  }

  function showLogin() {
    loginTicket = null;
    showLoginStep('loginForm');
  }

  function showForce() {
    $('forceForm').reset();
    renderRules($('forceForm').next);
    $('forceError').textContent = '';
    showLoginStep('forceForm');
  }

  // Owner sees everything; staff only the tabs they are allowed
  const can = (perm) => state.me?.role === 'owner' || (perm !== 'owner' && state.me?.permissions.includes(perm));

  async function showApp() {
    const [me, data] = await Promise.all([api('/api/admin/me'), api('/api/store')]);
    state.me = me;
    state.settings = data.settings;
    state.products = data.products;
    state.collections = data.collections || [];
    state.delivery = data.delivery || { fee: 0, freeAbove: 0, cityFees: [] };
    state.loyalty = data.loyalty || { enabled: false, earnPer: 100, pointValue: 1, maxPercent: 50 };
    state.stockSettings = data.stock || { lowAt: 3 };
    $('lowStockForm').lowAt.value = state.stockSettings.lowAt;
    $('loginView').hidden = true;
    $('appView').hidden = false;
    state.accountSettings = data.accounts || {};
    state.content = data.content;
    $('whoAmI').textContent = me.role === 'staff' ? `· ${me.name}` : '';
    document.querySelectorAll('.tab').forEach((t) => (t.hidden = !can(t.dataset.perm)));
    const current = document.querySelector('.tab.active');
    if (current.hidden) document.querySelector('.tab:not([hidden])')?.click();
    renderProducts();
    fillSettings();
    renderContent();
    renderCollections();
    renderDelivery();
    if (can('earn')) loadApplications();
    if (can('orders') || can('reports')) loadOrders();
    if (can('customers')) {
      loadUsers();
      loadPwRequests();
      renderLoyalty();
    }
    if (can('payments')) {
      loadPaymentSettings();
      loadCoupons();
    }
    if (can('reviews')) loadReviews();
    if (can('owner')) {
      loadNotify();
      loadSecurity();
      loadStaff();
    }
  }

  const afterLogin = (res) => (res.mustChangePassword ? showForce() : showApp());

  let loginTicket = null;
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginError').textContent = '';
    try {
      const res = await api('/api/admin/login', { method: 'POST', body: { username: $('loginUsername').value.trim(), password: $('loginPassword').value } });
      $('loginPassword').value = '';
      if (res.twoFactor) {
        loginTicket = res.ticket;
        $('loginCode').value = '';
        $('codeError').textContent = '';
        setRecoveryMode(false);
        showLoginStep('codeForm');
      } else {
        afterLogin(res);
      }
    } catch (err) {
      $('loginError').textContent = err.message;
    }
  });

  let recoveryMode = false;
  function setRecoveryMode(on) {
    recoveryMode = on;
    $('loginCode').placeholder = on ? 'xxxxx-xxxxx' : '123 456';
    $('loginCode').inputMode = on ? 'text' : 'numeric';
    $('codeHelp').innerHTML = on
      ? 'Enter one of the <strong>recovery codes</strong> you saved when you turned on Google Authenticator. Each code works once.'
      : 'Open <strong>Google Authenticator</strong> on your phone and enter the 6-digit code for this store.';
    $('useRecovery').textContent = on ? 'Use the Google Authenticator code instead' : 'Lost your phone? Use a recovery code';
  }
  $('useRecovery').addEventListener('click', () => {
    setRecoveryMode(!recoveryMode);
    $('loginCode').value = '';
    $('loginCode').focus();
  });
  $('backToPassword').addEventListener('click', showLogin);

  $('codeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('codeError').textContent = '';
    try {
      const res = await api('/api/admin/login/code', { method: 'POST', body: { ticket: loginTicket, code: $('loginCode').value } });
      afterLogin(res);
    } catch (err) {
      $('codeError').textContent = err.message;
      $('loginCode').select();
    }
  });

  // Password rules, shown as a live checklist (the server checks the same rules)
  const PW_RULES = [
    ['At least 10 characters', (p) => p.length >= 10],
    ['A capital letter (A–Z)', (p) => /[A-Z]/.test(p)],
    ['A small letter (a–z)', (p) => /[a-z]/.test(p)],
    ['A number (0–9)', (p) => /[0-9]/.test(p)],
    ['A symbol like ! @ # $', (p) => /[^A-Za-z0-9]/.test(p)],
    ['No easy words like "admin", "password" or "12345"', (p) => p && !/admin|password|qwerty|12345|abcde|wah/i.test(p)],
  ];
  const passwordStrong = (p) => PW_RULES.every(([, test]) => test(p));

  function renderRules(input) {
    $(input.dataset.rules).innerHTML = PW_RULES.map(([label, test]) => `<li class="${test(input.value) ? 'ok' : ''}">${escapeHtml(label)}</li>`).join('');
  }
  document.querySelectorAll('[data-rules]').forEach((input) => {
    renderRules(input);
    input.addEventListener('input', () => renderRules(input));
  });
  document.querySelectorAll('[data-show-pw]').forEach((box) =>
    box.addEventListener('change', () =>
      box.closest('form').querySelectorAll('input[name=current], input[name=next], input[name=confirm]').forEach((i) => (i.type = box.checked ? 'text' : 'password'))
    )
  );

  // Shared by the "must change" screen and the Security tab
  async function changePassword(form) {
    const { current, next, confirm } = form;
    if (!passwordStrong(next.value)) throw new Error('The new password does not meet all the rules yet');
    if (next.value !== confirm.value) throw new Error('The two new passwords do not match');
    await api('/api/admin/password', { method: 'POST', body: { current: current.value, next: next.value } });
    form.reset();
    renderRules(next);
  }

  $('forceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('forceError').textContent = '';
    try {
      await changePassword(e.target);
      await showApp();
      toast('Strong password saved');
    } catch (err) {
      $('forceError').textContent = err.message;
    }
  });

  async function logout() {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  }
  $('logoutBtn').addEventListener('click', logout);
  document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', logout));

  // ---------- security tab: Google Authenticator ----------
  async function loadSecurity() {
    try {
      renderTwoFactor(await api('/api/admin/me'));
    } catch {}
  }

  function renderTwoFactor(me, step = null, data = {}) {
    const panel = $('twoFactorPanel');
    const head = `<h2>Google Authenticator</h2>
      <span class="tfa-status${me.twoFactor ? ' on' : ''}">${me.twoFactor ? '● ON' : '● OFF'}</span>`;
    if (step === 'password') {
      panel.innerHTML = `${head}
        <p class="hint">Enter your admin password to start.</p>
        <form class="tfa-form" data-tfa="setup"><label>Password <input type="password" name="password" autocomplete="current-password" required></label>
        <div class="btn-row"><button class="btn btn-dark" type="submit">Continue</button><button type="button" class="btn btn-ghost" data-tfa-cancel>Cancel</button></div></form>`;
    } else if (step === 'scan') {
      panel.innerHTML = `${head}
        <ol class="tfa-steps">
          <li>Install <strong>Google Authenticator</strong> on your phone (Play Store / App Store).</li>
          <li>In the app tap <strong>+</strong> → <strong>Scan a QR code</strong> and scan this:</li>
        </ol>
        <div class="qr"><img src="${data.qr}" alt="QR code for Google Authenticator"><span class="pmeta">Can't scan? Choose "Enter a setup key" and type:</span><code>${escapeHtml(data.secret)}</code></div>
        <form class="tfa-form" data-tfa="enable"><label>3. Enter the 6-digit code the app shows <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label>
        <div class="btn-row"><button class="btn btn-accent" type="submit">Turn on</button><button type="button" class="btn btn-ghost" data-tfa-cancel>Cancel</button></div></form>`;
    } else if (step === 'codes') {
      panel.innerHTML = `${head}
        <p><strong>Save these recovery codes now.</strong> If you lose your phone, each code lets you log in once. They will not be shown again.</p>
        <div class="recovery-codes">${data.recoveryCodes.map((c) => `<code>${escapeHtml(c)}</code>`).join('')}</div>
        <div class="btn-row"><button type="button" class="btn btn-ghost" data-tfa-copy>Copy</button><button type="button" class="btn btn-ghost" data-tfa-download>Download</button><button type="button" class="btn btn-dark" data-tfa-cancel>I saved them</button></div>`;
      panel.dataset.codes = data.recoveryCodes.join('\n');
    } else if (step === 'disable') {
      panel.innerHTML = `${head}
        <form class="tfa-form" data-tfa="disable">
          <label>Password <input type="password" name="password" autocomplete="current-password" required></label>
          <label>Code from Google Authenticator (or a recovery code) <input name="code" autocomplete="one-time-code" required></label>
          <div class="btn-row"><button class="btn btn-dark" type="submit">Turn off</button><button type="button" class="btn btn-ghost" data-tfa-cancel>Cancel</button></div></form>`;
    } else {
      panel.innerHTML = me.twoFactor
        ? `${head}<p class="hint">Logging in needs your password <strong>and</strong> the 6-digit code from the Google Authenticator app on your phone.</p>
          <p class="pmeta">Recovery codes left: <strong>${me.recoveryCodesLeft}</strong>${me.recoveryCodesLeft < 3 ? ' — turn it off and on again to get new ones.' : ''}</p>
          <div class="btn-row"><button type="button" class="btn btn-ghost" data-tfa-start="disable">Turn off</button></div>`
        : `${head}<p class="hint">Add a second lock: after the password, the dashboard asks for a 6-digit code from the Google Authenticator app on your phone. Even if someone learns your password, they cannot log in without your phone.</p>
          <div class="btn-row"><button type="button" class="btn btn-accent" data-tfa-start="password">Turn on Google Authenticator</button></div>`;
    }
    panel.querySelector('input')?.focus();
  }

  $('twoFactorPanel').addEventListener('click', async (e) => {
    const panel = $('twoFactorPanel');
    const start = e.target.closest('[data-tfa-start]');
    if (start) renderTwoFactor(await api('/api/admin/me'), start.dataset.tfaStart);
    if (e.target.closest('[data-tfa-cancel]')) loadSecurity();
    if (e.target.closest('[data-tfa-copy]')) {
      navigator.clipboard.writeText(panel.dataset.codes).then(() => toast('Recovery codes copied'), () => toast('Please write the codes down', true));
    }
    if (e.target.closest('[data-tfa-download]')) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([`${state.settings.storeName} admin recovery codes\nEach code works once.\n\n${panel.dataset.codes}\n`], { type: 'text/plain' }));
      a.download = 'admin-recovery-codes.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  });

  $('twoFactorPanel').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const body = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const me = await api('/api/admin/me');
      if (form.dataset.tfa === 'setup') {
        renderTwoFactor(me, 'scan', await api('/api/admin/2fa/setup', { method: 'POST', body }));
      } else if (form.dataset.tfa === 'enable') {
        const res = await api('/api/admin/2fa/enable', { method: 'POST', body });
        renderTwoFactor({ ...me, twoFactor: true }, 'codes', res);
        toast('Google Authenticator is on');
      } else if (form.dataset.tfa === 'disable') {
        await api('/api/admin/2fa/disable', { method: 'POST', body });
        loadSecurity();
        toast('Google Authenticator is off');
      }
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });

  // ---------- tabs ----------
  document.querySelectorAll('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      ['orders', 'reports', 'products', 'collections', 'reviews', 'customers', 'payments', 'coupons', 'settings', 'pages', 'earn', 'staff', 'security'].forEach(
        (name) => ($(`tab-${name}`).hidden = tab.dataset.tab !== name)
      );
      if (tab.dataset.tab === 'security') loadSecurity();
      if (tab.dataset.tab === 'earn') loadApplications();
      if (tab.dataset.tab === 'reviews') loadReviews();
      if (tab.dataset.tab === 'collections') renderCollections();
      if (tab.dataset.tab === 'reports') loadOrders().then(renderReport);
    })
  );

  // ---------- orders ----------
  // Customers see these steps (with dates) under "My orders" and "Track your order"
  const STATUS_LABELS = {
    new: 'New', confirmed: 'Order confirmed', packing: 'Order packing', ready: 'Ready to deliver', picked: 'Order picked',
    shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned', rejected: 'Rejected', cancelled: 'Cancelled',
  };
  const QUICK_STATUSES = ['confirmed', 'packing', 'ready', 'picked', 'shipped', 'delivered', 'returned', 'rejected'];
  // Orders in these states do not count towards sales
  const LOST_STATUSES = ['cancelled', 'returned', 'rejected'];
  const PAYMENT_LABELS = { unpaid: 'Unpaid', pending: 'Awaiting payment', paid: 'Paid', failed: 'Payment failed' };
  const METHOD_LABELS = { cod: 'COD', safepay: 'Safepay', easypaisa: 'Easypaisa', manual: 'Transfer' };
  const MANUAL_TYPES = { bank: 'Bank transfer', easypaisa: 'Easypaisa', jazzcash: 'JazzCash', other: 'Other' };
  const methodLabel = (o) => (o.paymentMethod === 'manual' ? MANUAL_TYPES[o.manualPayment?.type] || 'Transfer' : METHOD_LABELS[o.paymentMethod] || o.paymentMethod);

  async function loadOrders() {
    try {
      state.orders = await api('/api/admin/orders');
      renderOrders();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function shownOrders() {
    const q = state.orderSearch.toLowerCase();
    return state.orders.filter((o) => {
      if (state.orderFilter !== 'all' && o.status !== state.orderFilter) return false;
      const c = o.customer;
      return !q || `#${o.number} ${o.number} ${c.firstName} ${c.lastName} ${c.phone} ${c.city} ${c.email} ${o.manualPayment?.reference || ''}`.toLowerCase().includes(q);
    });
  }

  // ---------- packing slips ----------
  // Opens a print-ready page: one slip per order (name, address, items, amount to collect).
  function printSlips(orders) {
    if (!orders.length) return toast('No orders to print', true);
    const s = state.settings;
    const contact = [s.social?.phone || s.social?.whatsapp, s.social?.email].filter(Boolean).join(' · ');
    const slip = (o) => {
      const c = o.customer;
      const collect = o.paymentStatus === 'paid' ? 0 : o.paymentMethod === 'cod' ? o.total : 0;
      const payNote = o.paymentStatus === 'paid' ? 'PAID' : o.paymentMethod === 'cod' ? 'CASH ON DELIVERY' : 'PAYMENT PENDING — check before sending';
      return `
      <section class="slip">
        <header><div><h1>${escapeHtml(s.storeName)}</h1>${contact ? `<p>${escapeHtml(contact)}</p>` : ''}</div>
          <div class="no"><b>Order #${o.number}</b><span>${new Date(o.createdAt).toLocaleDateString('en-PK', { dateStyle: 'medium' })}</span></div></header>
        <div class="to"><small>DELIVER TO</small>
          <b>${escapeHtml(c.firstName)} ${escapeHtml(c.lastName)}</b>
          <span>📞 ${escapeHtml(c.phone)}</span>
          <span>${escapeHtml(c.address)}</span>
          <b class="city">${escapeHtml(c.city)}</b>
          ${c.notes ? `<i>Note: ${escapeHtml(c.notes)}</i>` : ''}</div>
        <table><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>
          ${o.items.map((i) => `<tr><td>${escapeHtml(i.name)}${[i.size, i.color].filter(Boolean).length ? ` <small>(${[i.size, i.color].filter(Boolean).map(escapeHtml).join(', ')})</small>` : ''}</td><td>${i.qty}</td><td>${money(i.price * i.qty)}</td></tr>`).join('')}
        </tbody></table>
        <div class="sums">
          ${o.deliveryFee ? `<div><span>Subtotal</span><span>${money(o.subtotal ?? o.total - o.deliveryFee)}</span></div><div><span>Delivery</span><span>${money(o.deliveryFee)}</span></div>` : ''}
          <div><span>Total</span><span>${money(o.total)}</span></div>
        </div>
        <div class="collect"><span>${payNote}</span><b>${collect ? `Collect ${money(collect)}` : 'Collect Rs. 0'}</b></div>
      </section>`;
    };
    const w = window.open('', '_blank');
    if (!w) return toast('Please allow pop-ups for this site to print', true);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Packing slips</title><style>
      *{box-sizing:border-box} body{font-family:system-ui,-apple-system,sans-serif;margin:0;color:#111}
      .bar{padding:12px;text-align:center;background:#f4f1ec} .bar button{font:inherit;font-weight:700;padding:10px 24px;border-radius:8px;border:0;background:#111;color:#fff;cursor:pointer}
      .slip{width:148mm;min-height:190mm;margin:10mm auto;padding:8mm;border:1.5px dashed #999;page-break-after:always;display:flex;flex-direction:column;gap:5mm;font-size:12pt}
      header{display:flex;justify-content:space-between;gap:8mm;border-bottom:2px solid #111;padding-bottom:3mm} h1{margin:0;font-size:18pt} header p{margin:1mm 0 0;font-size:10pt}
      .no{text-align:right;display:flex;flex-direction:column} .no b{font-size:15pt}
      .to{display:flex;flex-direction:column;gap:1mm;border:2px solid #111;border-radius:3mm;padding:4mm;font-size:13pt} .to small{font-size:9pt;letter-spacing:1px;color:#555} .to .city{font-size:16pt;text-transform:uppercase}
      table{width:100%;border-collapse:collapse;font-size:11pt} th,td{border-bottom:1px solid #ccc;padding:2mm 1mm;text-align:left} th:nth-child(n+2),td:nth-child(n+2){text-align:right;white-space:nowrap}
      .sums{display:grid;gap:1mm;margin-left:auto;min-width:60%} .sums div{display:flex;justify-content:space-between} .sums div:last-child{font-weight:800;font-size:13pt;border-top:1px solid #111;padding-top:1mm}
      .collect{margin-top:auto;display:flex;justify-content:space-between;align-items:center;background:#111;color:#fff;padding:4mm;border-radius:3mm} .collect b{font-size:16pt}
      @media print{.bar{display:none} .slip{margin:0 auto;border:0}} @page{size:A5;margin:6mm}
    </style></head><body><div class="bar"><button onclick="print()">🖨 Print ${orders.length} slip(s)</button></div>${orders.map(slip).join('')}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  $('printShownBtn').addEventListener('click', () => {
    const list = shownOrders();
    if (list.length > 30 && !confirm(`Print ${list.length} slips?`)) return;
    printSlips(list);
  });

  function renderOrders() {
    const all = state.orders;
    const sum = (list) => list.reduce((n, o) => n + o.total, 0);
    const byStatus = (status) => all.filter((o) => o.status === status);
    const active = all.filter((o) => !LOST_STATUSES.includes(o.status));
    const newCount = byStatus('new').length;
    $('newOrdersBadge').textContent = newCount;
    $('newOrdersBadge').hidden = !newCount;
    const card = (filter, value, label, sub = '') =>
      `<button class="stat${filter !== 'all' && state.orderFilter === filter ? ' active' : ''}" data-stat-filter="${filter}"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</button>`;
    const statusCard = (status, label) => card(status, byStatus(status).length, label, money(sum(byStatus(status))));
    $('orderStats').innerHTML = [
      card('new', newCount, 'New orders'),
      statusCard('confirmed', 'Confirmed'),
      statusCard('packing', 'Packing'),
      statusCard('ready', 'Ready to deliver'),
      statusCard('picked', 'Picked'),
      statusCard('shipped', 'Shipped'),
      statusCard('delivered', 'Delivered'),
      statusCard('returned', 'Returned'),
      statusCard('rejected', 'Rejected'),
      card('all', money(sum(active)), 'Net sales', `${active.length} orders`),
      card('all', money(sum(active.filter((o) => o.paymentStatus === 'paid'))), 'Payment received'),
    ].join('');

    const list = shownOrders();

    $('orderList').innerHTML = list.length
      ? list
          .map((o) => {
            const c = o.customer;
            const waNumber = c.phone.replace(/\D/g, '').replace(/^0/, '92');
            return `
          <article class="order status-${o.status}" data-id="${escapeHtml(o.id)}">
            <header class="order-head">
              <div>
                <div class="order-no">#${o.number}</div>
                <div class="pmeta">${new Date(o.createdAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}</div>
              </div>
              <span class="pay-badge pay-${o.paymentStatus}">${escapeHtml(methodLabel(o))} · ${PAYMENT_LABELS[o.paymentStatus] || o.paymentStatus}</span>
              <select class="status-select" data-order-status aria-label="Order status">
                ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}"${o.status === v ? ' selected' : ''}>${l}</option>`).join('')}
              </select>
              <button class="btn btn-sm btn-ghost" data-print-slip title="Print packing slip">🖨 Slip</button>
            </header>
            <details class="courier-edit"${o.courier?.trackingNo ? '' : ''}>
              <summary>🚚 Courier${o.courier?.trackingNo ? `: <b>${escapeHtml(o.courier.name)} · ${escapeHtml(o.courier.trackingNo)}</b>` : ' — add tracking number'}</summary>
              <div class="courier-fields">
                <select data-courier="name" aria-label="Courier">${COURIERS.map((c) => `<option${o.courier?.name === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
                <input data-courier="trackingNo" placeholder="Tracking number" maxlength="60" value="${escapeHtml(o.courier?.trackingNo || '')}">
                <input data-courier="link" type="url" placeholder="Tracking link (optional)" value="${escapeHtml(o.courier?.link || '')}">
                <button class="btn btn-sm btn-dark" data-courier-save>Save</button>
                ${o.courier?.trackingNo ? `<a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="https://wa.me/${escapeHtml(waNumber)}?text=${encodeURIComponent(`Assalam o Alaikum ${c.firstName}! Your order #${o.number} from ${state.settings.storeName} has been sent with ${o.courier.name}. Tracking number: ${o.courier.trackingNo}${o.courier.link ? `\nTrack: ${o.courier.link}` : ''}`)}">Send on WhatsApp</a>` : ''}
              </div>
            </details>
            <div class="quick-status">
              <span>Mark as:</span>
              ${QUICK_STATUSES.map((st) => `<button class="qs qs-${st}${o.status === st ? ' on' : ''}" data-quick-status="${st}">${STATUS_LABELS[st]}</button>`).join('')}
            </div>
            <div class="order-body">
              <div class="order-customer">
                <div class="pname">${escapeHtml(c.firstName)} ${escapeHtml(c.lastName)}${o.userId ? '<span class="badge-user">Registered</span>' : ''}</div>
                <div><a href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a> · <a href="https://wa.me/${escapeHtml(waNumber)}" target="_blank" rel="noopener">WhatsApp</a></div>
                ${c.email ? `<div><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></div>` : ''}
                <div class="order-address">${escapeHtml(c.address)}<br><strong>${escapeHtml(c.city)}</strong></div>
                ${c.notes ? `<div class="order-notes">Note: ${escapeHtml(c.notes)}</div>` : ''}
              </div>
              <div class="order-items">
                ${o.items.map((i) => `<div><span>${i.qty} × ${escapeHtml(i.name)}${[i.size, i.color].filter(Boolean).length ? ` <small>(${[i.size, i.color].filter(Boolean).map(escapeHtml).join(', ')})</small>` : ''}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}
                ${o.deliveryFee ? `<div class="pmeta"><span>Delivery</span><span>${money(o.deliveryFee)}</span></div>` : ''}
                ${o.couponDiscount ? `<div class="pmeta"><span>Coupon ${escapeHtml(o.coupon?.code || '')}</span><span>− ${money(o.couponDiscount)}</span></div>` : ''}
                ${o.pointsDiscount ? `<div class="pmeta"><span>Points used (${o.pointsUsed})</span><span>− ${money(o.pointsDiscount)}</span></div>` : ''}
                ${o.cancelledBy === 'customer' ? '<div class="pmeta"><b>Cancelled by the customer</b></div>' : ''}
                <div class="order-total"><span>Total</span><span>${money(o.total)}</span></div>
                ${o.safepay?.reference ? `<div class="pmeta">Safepay ref: ${escapeHtml(o.safepay.reference)}</div>` : ''}
                ${o.manualPayment ? `<div class="pmeta">Paid to: ${escapeHtml([o.manualPayment.name, o.manualPayment.accountTitle, o.manualPayment.accountNumber || o.manualPayment.iban].filter(Boolean).join(' · '))}</div>
                  <div><b>TID: ${escapeHtml(o.manualPayment.reference)}</b></div>
                  ${o.manualPayment.receipt ? `<a class="receipt-link" href="/api/admin/receipts/${encodeURIComponent(o.manualPayment.receipt)}" target="_blank" rel="noopener">View payment screenshot</a>` : '<div class="pmeta">No screenshot</div>'}` : ''}
                ${o.easypaisa ? `<div class="pmeta">Easypaisa order ref: ${escapeHtml(o.easypaisa.orderRef)}${o.easypaisa.transactionId ? ` · Transaction: ${escapeHtml(o.easypaisa.transactionId)}` : ''}</div>` : ''}
                ${o.paymentStatus !== 'paid' ? `<div class="order-actions">
                  ${o.paymentMethod === 'easypaisa' ? '<button class="btn btn-sm btn-dark" data-check-payment>Check payment</button>' : ''}
                  <button class="btn btn-sm btn-ghost" data-mark-paid>Mark as paid</button>
                </div>` : ''}
              </div>
            </div>
          </article>`;
          })
          .join('')
      : `<div class="empty">${all.length ? 'No orders match.' : 'No orders yet. They will show up here when customers check out.'}</div>`;
  }

  const COURIERS = ['TCS', 'Leopards', 'M&P', 'PostEx', 'Trax', 'Call Courier', 'BlueEx', 'Swyft', 'Rider', 'Pakistan Post', 'Other'];

  async function updateOrder(id, changes) {
    try {
      const updated = await api(`/api/admin/orders/${id}`, { method: 'PATCH', body: changes });
      Object.assign(state.orders.find((o) => o.id === id), updated);
      renderOrders();
      toast('Order updated');
    } catch (err) {
      toast(err.message, true);
    }
  }

  $('orderList').addEventListener('change', (e) => {
    if (!e.target.matches('[data-order-status]')) return;
    updateOrder(e.target.closest('.order').dataset.id, { status: e.target.value });
  });
  $('orderStats').addEventListener('click', (e) => {
    const card = e.target.closest('[data-stat-filter]');
    if (!card) return;
    state.orderFilter = card.dataset.statFilter;
    $('orderFilter').value = state.orderFilter;
    renderOrders();
  });

  $('orderList').addEventListener('click', async (e) => {
    const courierSave = e.target.closest('[data-courier-save]');
    if (courierSave) {
      const box = courierSave.closest('.courier-fields');
      const courier = Object.fromEntries([...box.querySelectorAll('[data-courier]')].map((el) => [el.dataset.courier, el.value]));
      if (!courier.trackingNo.trim()) return toast('Please enter the tracking number', true);
      updateOrder(e.target.closest('.order').dataset.id, { courier });
      return;
    }
    if (e.target.closest('[data-print-slip]')) {
      printSlips([state.orders.find((o) => o.id === e.target.closest('.order').dataset.id)]);
      return;
    }
    const quick = e.target.closest('[data-quick-status]');
    if (quick) {
      const order = state.orders.find((o) => o.id === e.target.closest('.order').dataset.id);
      const status = quick.dataset.quickStatus;
      if (order.status === status) return;
      if (LOST_STATUSES.includes(status) && !confirm(`Mark order #${order.number} as ${STATUS_LABELS[status]}? It will no longer count in sales.`)) return;
      updateOrder(order.id, { status });
      return;
    }
    const check = e.target.closest('[data-check-payment]');
    if (check) {
      const id = e.target.closest('.order').dataset.id;
      check.disabled = true;
      try {
        const updated = await api(`/api/admin/orders/${id}/check-payment`, { method: 'POST' });
        Object.assign(state.orders.find((o) => o.id === id), updated);
        renderOrders();
        toast(updated.paymentStatus === 'paid' ? 'Payment confirmed by Easypaisa' : `Not paid yet (Easypaisa: ${updated.easypaisa.transactionStatus || 'no record'})`);
      } catch (err) {
        check.disabled = false;
        toast(err.message, true);
      }
      return;
    }
    if (!e.target.closest('[data-mark-paid]')) return;
    const order = state.orders.find((o) => o.id === e.target.closest('.order').dataset.id);
    if (confirm(`Mark order #${order.number} as paid?`)) updateOrder(order.id, { paymentStatus: 'paid' });
  });
  $('orderSearch').addEventListener('input', (e) => {
    state.orderSearch = e.target.value.trim();
    renderOrders();
  });
  $('orderFilter').addEventListener('change', (e) => {
    state.orderFilter = e.target.value;
    renderOrders();
  });
  $('refreshOrdersBtn').addEventListener('click', loadOrders);

  // ---------- loyalty points ----------
  const loyaltyForm = $('loyaltyForm');

  function renderLoyalty() {
    const l = state.loyalty;
    loyaltyForm.enabled.checked = l.enabled;
    loyaltyForm.earnPer.value = l.earnPer;
    loyaltyForm.pointValue.value = l.pointValue;
    loyaltyForm.maxPercent.value = l.maxPercent;
    loyaltyExample();
  }

  function loyaltyExample() {
    const f = loyaltyForm;
    const pts = Math.floor(5000 / (Number(f.earnPer.value) || 1));
    $('loyaltyExample').textContent = `Example: an order of ${money(5000)} earns ${pts} points, worth ${money(pts * (Number(f.pointValue.value) || 0))} on the next order.`;
  }
  loyaltyForm.addEventListener('input', loyaltyExample);

  loyaltyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = loyaltyForm;
    try {
      state.loyalty = await api('/api/admin/loyalty', {
        method: 'PUT',
        body: { enabled: f.enabled.checked, earnPer: Number(f.earnPer.value), pointValue: Number(f.pointValue.value), maxPercent: Number(f.maxPercent.value) },
      });
      renderLoyalty();
      toast('Loyalty points saved');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- forgot password requests ----------
  async function loadPwRequests() {
    try {
      const list = await api('/api/admin/password-requests');
      const open = list.filter((r) => r.status === 'new');
      $('pwRequestsPanel').hidden = !open.length;
      $('pwRequests').innerHTML = open
        .map(
          (r) => `
        <div class="urow" data-id="${escapeHtml(r.id)}" data-user="${escapeHtml(r.userId)}">
          <div class="avatar">🔑</div>
          <div>
            <div class="pname">${escapeHtml(r.name)}</div>
            <div class="pmeta"><a href="tel:${escapeHtml(r.phone)}">${escapeHtml(r.phone)}</a> · ${escapeHtml(r.email)} · ${new Date(r.createdAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          </div>
          <div></div>
          <div class="pactions">
            <button class="btn btn-sm btn-accent" data-pw="set">Set password</button>
            <button class="btn btn-sm btn-ghost" data-pw="done">Done</button>
          </div>
        </div>`
        )
        .join('');
    } catch (err) {
      toast(err.message, true);
    }
  }

  $('pwRequests').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pw]');
    if (!btn) return;
    const row = e.target.closest('.urow');
    if (btn.dataset.pw === 'set') {
      const user = state.users.find((u) => u.id === row.dataset.user);
      if (!user) return toast('This customer was deleted', true);
      openUserEditor(user);
      userForm.newPassword.focus();
      return;
    }
    try {
      await api(`/api/admin/password-requests/${row.dataset.id}`, { method: 'PATCH', body: { status: 'done' } });
      loadPwRequests();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- customers ----------
  async function loadUsers() {
    try {
      state.users = await api('/api/admin/users');
      renderUsers();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderUsers() {
    const box = $('accountSettings');
    box.querySelector('[name=allowRegistration]').checked = state.accountSettings.allowRegistration;
    box.querySelector('[name=requireLogin]').checked = state.accountSettings.requireLogin;

    const all = state.users;
    const month = Date.now() - 30 * 24 * 3600 * 1000;
    $('userStats').innerHTML = [
      [all.length, 'Customers'],
      [all.filter((u) => new Date(u.createdAt) > month).length, 'New this month'],
      [all.filter((u) => u.orderCount > 0).length, 'Have ordered'],
      [all.filter((u) => u.blocked).length, 'Blocked'],
    ].map(([n, label]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join('');

    const q = state.userSearch.toLowerCase();
    const list = all.filter((u) => {
      if (state.userFilter === 'active' && u.blocked) return false;
      if (state.userFilter === 'blocked' && !u.blocked) return false;
      return !q || `${u.firstName} ${u.lastName} ${u.email} ${u.phone} ${u.city}`.toLowerCase().includes(q);
    });
    $('userList').innerHTML = list.length
      ? list
          .map(
            (u) => `
        <div class="urow${u.blocked ? ' is-blocked' : ''}" data-id="${escapeHtml(u.id)}">
          <div class="avatar">${escapeHtml((u.firstName[0] || '') + (u.lastName[0] || ''))}</div>
          <div>
            <div class="pname">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}${u.blocked ? '<span class="badge-blocked">Blocked</span>' : ''}</div>
            <div class="pmeta">${escapeHtml(u.email)} · <a href="tel:${escapeHtml(u.phone)}">${escapeHtml(u.phone)}</a>${u.city ? ` · ${escapeHtml(u.city)}` : ''}</div>
            <div class="pmeta">Joined ${new Date(u.createdAt).toLocaleDateString('en-PK', { dateStyle: 'medium' })}${u.lastLoginAt ? ` · Last login ${new Date(u.lastLoginAt).toLocaleDateString('en-PK', { dateStyle: 'medium' })}` : ''}</div>
          </div>
          <div class="ustats"><b>${u.orderCount} order(s)</b>${money(u.spent)}${u.points ? `<span class="pts">⭐ ${u.points} pts</span>` : ''}</div>
          <div class="pactions">
            <button class="btn btn-sm btn-dark" data-user-action="edit">Edit</button>
            <button class="btn btn-sm btn-ghost" data-user-action="block">${u.blocked ? 'Unblock' : 'Block'}</button>
            <button class="btn btn-sm btn-ghost" data-user-action="delete">Delete</button>
          </div>
        </div>`
          )
          .join('')
      : `<div class="empty">${all.length ? 'No customers match.' : 'No customer accounts yet.'}</div>`;
  }

  async function saveUser(user, changes) {
    const body = { ...user, ...changes };
    const updated = await api(`/api/admin/users/${user.id}`, { method: 'PUT', body });
    Object.assign(user, updated);
    renderUsers();
  }

  $('accountSettings').addEventListener('change', async () => {
    const box = $('accountSettings');
    const body = {
      allowRegistration: box.querySelector('[name=allowRegistration]').checked,
      requireLogin: box.querySelector('[name=requireLogin]').checked,
    };
    try {
      state.accountSettings = await api('/api/admin/account-settings', { method: 'PUT', body });
      toast('Saved');
    } catch (err) {
      toast(err.message, true);
      renderUsers();
    }
  });

  $('userList').addEventListener('click', async (e) => {
    const action = e.target.closest('[data-user-action]')?.dataset.userAction;
    if (!action) return;
    const user = state.users.find((u) => u.id === e.target.closest('.urow').dataset.id);
    const name = `${user.firstName} ${user.lastName}`;
    try {
      if (action === 'edit') openUserEditor(user);
      if (action === 'block' && confirm(user.blocked ? `Unblock ${name}?` : `Block ${name}? They will be logged out and cannot log in.`)) {
        await saveUser(user, { blocked: !user.blocked });
        toast(user.blocked ? 'Customer blocked' : 'Customer unblocked');
      }
      if (action === 'delete' && confirm(`Delete ${name}'s account? Their past orders stay in the Orders tab.`)) {
        await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
        state.users = state.users.filter((u) => u.id !== user.id);
        renderUsers();
        toast('Customer deleted');
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  const userForm = $('userForm');
  const USER_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'address', 'city'];

  function openUserEditor(user) {
    state.editingUser = user;
    userForm.reset();
    USER_FIELDS.forEach((k) => (userForm[k].value = user[k] || ''));
    userForm.blocked.checked = user.blocked;
    userForm.points.value = user.points || 0;
    $('userMeta').textContent = `${user.orderCount} order(s) · ${money(user.spent)} spent`;
    $('userEditor').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeUserEditor() {
    $('userEditor').hidden = true;
    document.body.style.overflow = '';
  }

  $('userEditor').addEventListener('click', (e) => {
    if (e.target === $('userEditor') || e.target.closest('[data-close]')) closeUserEditor();
  });

  userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const changes = Object.fromEntries(USER_FIELDS.map((k) => [k, userForm[k].value]));
    changes.blocked = userForm.blocked.checked;
    changes.newPassword = userForm.newPassword.value;
    changes.points = Number(userForm.points.value) || 0;
    $('saveUserBtn').disabled = true;
    try {
      await saveUser(state.editingUser, changes);
      closeUserEditor();
      if (changes.newPassword) {
        loadPwRequests();
        const u = state.editingUser;
        const wa = u.phone.replace(/\D/g, '').replace(/^0/, '92');
        const text = `Assalam o Alaikum ${u.firstName}! Your new password for ${state.settings.storeName} is: ${changes.newPassword}\nPlease log in and change it from My account.`;
        if (confirm('Password saved. Send it to the customer on WhatsApp now?')) window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      } else toast('Customer saved');
    } catch (err) {
      toast(err.message, true);
    } finally {
      $('saveUserBtn').disabled = false;
    }
  });

  $('userSearch').addEventListener('input', (e) => {
    state.userSearch = e.target.value.trim();
    renderUsers();
  });
  $('userFilter').addEventListener('change', (e) => {
    state.userFilter = e.target.value;
    renderUsers();
  });
  $('refreshUsersBtn').addEventListener('click', loadUsers);

  // ---------- payment settings ----------
  const paymentForm = $('paymentForm');

  async function loadPaymentSettings() {
    try {
      state.payment = await api('/api/admin/payment-settings');
      renderPaymentSettings();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderPaymentSettings() {
    const p = state.payment;
    paymentForm.cod.checked = p.cod;
    const onOff = (on) => (on ? 'ON' : 'OFF');
    $('gatewayStatus').textContent = `Online gateways — Easypaisa: ${onOff(p.gateways.easypaisa)}, Safepay: ${onOff(p.gateways.safepay)}. These are switched on with the API keys on the server (see README).`;
    $('manualList').innerHTML = p.manualAccounts.length
      ? p.manualAccounts
          .map(
            (a, i) => `
        <div class="manual-card${a.enabled ? '' : ' off'}" data-index="${i}">
          <div class="manual-card-head">
            <select data-field="type" aria-label="Type">
              ${Object.entries(MANUAL_TYPES).map(([v, l]) => `<option value="${v}"${a.type === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
            <label class="switch"><input type="checkbox" data-field="enabled"${a.enabled ? ' checked' : ''}><span></span> Show to customers</label>
            <button type="button" class="btn btn-sm btn-ghost" data-remove-account>Remove</button>
          </div>
          <label>Bank / wallet name <small>e.g. Meezan Bank, JazzCash</small><input data-field="name" maxlength="80" value="${escapeHtml(a.name)}"></label>
          <div class="row">
            <label>Account title <input data-field="accountTitle" maxlength="80" value="${escapeHtml(a.accountTitle)}"></label>
            <label>Account / mobile number <input data-field="accountNumber" maxlength="40" value="${escapeHtml(a.accountNumber)}"></label>
          </div>
          <label>IBAN <small>Optional, for banks</small><input data-field="iban" maxlength="40" value="${escapeHtml(a.iban)}"></label>
          <label>Note for customers <small>Optional, e.g. “Send screenshot on WhatsApp”</small><input data-field="instructions" maxlength="400" value="${escapeHtml(a.instructions)}"></label>
        </div>`
          )
          .join('')
      : '<div class="empty">No accounts yet. Click “+ Add account”.</div>';
  }

  // Copies what is typed in the cards back into state, so re-rendering keeps it.
  function readManualCards() {
    paymentForm.querySelectorAll('.manual-card').forEach((card) => {
      const a = state.payment.manualAccounts[Number(card.dataset.index)];
      card.querySelectorAll('[data-field]').forEach((el) => (a[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value));
    });
  }

  $('addManualBtn').addEventListener('click', () => {
    readManualCards();
    state.payment.manualAccounts.push({ type: 'bank', name: '', accountTitle: '', accountNumber: '', iban: '', instructions: '', enabled: true });
    renderPaymentSettings();
    paymentForm.querySelector('.manual-card:last-child [data-field=name]').focus();
  });

  $('manualList').addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove-account]');
    if (!remove || !confirm('Remove this account? Customers will no longer see it.')) return;
    readManualCards();
    state.payment.manualAccounts.splice(Number(remove.closest('.manual-card').dataset.index), 1);
    renderPaymentSettings();
  });

  $('manualList').addEventListener('change', (e) => {
    if (e.target.dataset.field === 'enabled') e.target.closest('.manual-card').classList.toggle('off', !e.target.checked);
  });

  paymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    readManualCards();
    try {
      state.payment = await api('/api/admin/payment-settings', {
        method: 'PUT',
        body: { cod: paymentForm.cod.checked, manualAccounts: state.payment.manualAccounts },
      });
      renderPaymentSettings();
      toast('Payment settings saved');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- products list ----------
  function renderProducts() {
    const all = state.products;
    $('stats').innerHTML = [
      [all.length, 'Total products'],
      [all.filter((p) => !p.soldOut).length, 'Available'],
      [all.filter((p) => p.onSale).length, 'On sale'],
      [all.filter((p) => p.soldOut).length, 'Sold out'],
      [all.filter(isLowStock).length, 'Low stock'],
    ].map(([n, label]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join('');

    const q = state.search.toLowerCase();
    const list = all.filter((p) => {
      if (state.filter === 'sale' && !p.onSale) return false;
      if (state.filter === 'sold' && !p.soldOut) return false;
      if (state.filter === 'available' && p.soldOut) return false;
      if (state.filter === 'low' && !isLowStock(p)) return false;
      return !q || `${p.name} ${p.category}`.toLowerCase().includes(q);
    });

    // Reordering only makes sense on the full list
    const reorder = state.filter === 'all' && !q;
    $('reorderHint').hidden = !reorder || all.length < 2;
    $('productList').classList.toggle('reorderable', reorder);
    $('productList').innerHTML = list.length
      ? list
          .map((p, i) => {
            const img = p.images?.[0];
            const hasDiscount = p.onSale && p.salePrice != null;
            return `
          <div class="prow${p.soldOut ? ' is-sold' : ''}" data-id="${escapeHtml(p.id)}"${reorder ? ' draggable="true"' : ''}>
            ${reorder ? `<div class="reorder">
              <button type="button" data-move="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
              <span class="grip" title="Drag to move">⠿</span>
              <button type="button" data-move="1" aria-label="Move down" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
            </div>` : ''}
            <div class="pthumb" style="${img ? '' : 'background:#c9a3a0'}">${img ? `<img src="${escapeHtml(img)}" alt="">` : escapeHtml(p.name.charAt(0))}</div>
            <div>
              <div class="pname">${escapeHtml(p.name)}</div>
              <div class="pmeta">${escapeHtml(p.category || 'No category')} · ${p.images?.length || 0} picture(s)${p.trackStock ? ` · <b class="${isLowStock(p) ? 'low' : ''}">${stockTotal(p)} in stock</b>` : ''}</div>
              <div class="pprice">${hasDiscount ? `${money(p.salePrice)}<s>${money(p.price)}</s>` : money(p.price)}</div>
            </div>
            <div class="toggles">
              <button class="toggle sale${p.onSale ? ' on' : ''}" data-toggle="onSale">On sale</button>
              <button class="toggle sold${p.soldOut ? ' on' : ''}" data-toggle="soldOut">Sold out</button>
              <button class="toggle featured${p.featured ? ' on' : ''}" data-toggle="featured">Trending</button>
            </div>
            <div class="pactions">
              <button class="btn btn-sm btn-dark" data-action="edit">Edit</button>
              <button class="btn btn-sm btn-ghost" data-action="delete">Delete</button>
            </div>
          </div>`;
          })
          .join('')
      : '<div class="empty">No products here yet. Click “+ Add product”.</div>';
  }

  // ---------- stock ----------
  const stockTotal = (p) => Object.values(p.stock || {}).reduce((n, v) => n + (Number(v) || 0), 0);
  // Low: counting stock and some size/colour is at or below the warning level (but not all sold out)
  const isLowStock = (p) => p.trackStock && !p.soldOut && Object.values(p.stock || {}).some((v) => Number(v) <= state.stockSettings.lowAt);

  $('lowStockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      state.stockSettings = await api('/api/admin/stock-settings', { method: 'PUT', body: { lowAt: Number(e.target.lowAt.value) || 0 } });
      renderProducts();
      toast('Saved');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Stock grid in the product editor: one box per size × colour, rebuilt when sizes/colours change
  const splitList = (v) => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))];
  function readStockGrid() {
    const out = { ...(state.editStock || {}) };
    $('stockGrid').querySelectorAll('[data-stock]').forEach((i) => (out[i.dataset.stock] = Number(i.value) || 0));
    return out;
  }
  function renderStockGrid() {
    const on = form.trackStock.checked;
    $('stockGrid').hidden = $('stockHelp').hidden = !on;
    if (!on) return;
    state.editStock = readStockGrid();
    const sizes = splitList(form.sizes.value);
    const colors = splitList(form.colors.value);
    const rows = sizes.length ? sizes : [''];
    const cols = colors.length ? colors : [''];
    const cell = (sz, c) => `<input type="number" min="0" step="1" data-stock="${escapeHtml(`${sz}|${c}`)}" value="${state.editStock[`${sz}|${c}`] ?? 0}" aria-label="Stock ${escapeHtml([sz, c].filter(Boolean).join(' '))}">`;
    $('stockGrid').innerHTML = `<table><thead><tr><th></th>${cols.map((c) => `<th>${escapeHtml(c || 'Qty')}</th>`).join('')}</tr></thead><tbody>${rows
      .map((sz) => `<tr><th>${escapeHtml(sz || (colors.length ? 'Qty' : 'Pieces'))}</th>${cols.map((c) => `<td>${cell(sz, c)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;
  }
  // (the product form is set up further down, so look it up directly here)
  ['trackStock', 'sizes', 'colors'].forEach((name) => $('productForm')[name].addEventListener('change', renderStockGrid));

  // ---------- product order (drag, or ↑ ↓ on phones) ----------
  async function saveProductOrder() {
    try {
      await api('/api/admin/products/order', { method: 'PUT', body: { ids: state.products.map((p) => p.id) } });
      toast('Order saved');
    } catch (err) {
      toast(err.message, true);
    }
  }

  function moveProduct(id, toIndex) {
    const from = state.products.findIndex((p) => p.id === id);
    const [item] = state.products.splice(from, 1);
    state.products.splice(Math.max(0, Math.min(toIndex, state.products.length)), 0, item);
    renderProducts();
    saveProductOrder();
  }

  let draggedId = null;
  $('productList').addEventListener('dragstart', (e) => {
    const row = e.target.closest('.prow');
    if (!row) return;
    draggedId = row.dataset.id;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  $('productList').addEventListener('dragend', () => {
    draggedId = null;
    document.querySelectorAll('.prow.dragging, .prow.drop-before, .prow.drop-after').forEach((r) => r.classList.remove('dragging', 'drop-before', 'drop-after'));
  });
  $('productList').addEventListener('dragover', (e) => {
    const row = e.target.closest('.prow');
    if (!draggedId || !row) return;
    e.preventDefault();
    const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    document.querySelectorAll('.prow.drop-before, .prow.drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    row.classList.add(after ? 'drop-after' : 'drop-before');
  });
  $('productList').addEventListener('drop', (e) => {
    const row = e.target.closest('.prow');
    if (!draggedId || !row || row.dataset.id === draggedId) return;
    e.preventDefault();
    const after = row.classList.contains('drop-after');
    const without = state.products.filter((p) => p.id !== draggedId);
    const target = without.findIndex((p) => p.id === row.dataset.id) + (after ? 1 : 0);
    moveProduct(draggedId, target);
  });

  $('productSearch').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    renderProducts();
  });
  $('productFilter').addEventListener('change', (e) => {
    state.filter = e.target.value;
    renderProducts();
  });

  $('productList').addEventListener('click', async (e) => {
    const row = e.target.closest('.prow');
    if (!row) return;
    const product = state.products.find((p) => p.id === row.dataset.id);

    const move = e.target.closest('[data-move]');
    if (move) {
      moveProduct(product.id, state.products.indexOf(product) + Number(move.dataset.move));
      return;
    }

    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const key = toggle.dataset.toggle;
      try {
        const updated = await api(`/api/admin/products/${product.id}`, { method: 'PATCH', body: { [key]: !product[key] } });
        Object.assign(product, updated);
        renderProducts();
        toast('Updated');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'edit') openEditor(product);
    if (action === 'delete' && confirm(`Delete "${product.name}"? This cannot be undone.`)) {
      try {
        await api(`/api/admin/products/${product.id}`, { method: 'DELETE' });
        state.products = state.products.filter((p) => p.id !== product.id);
        renderProducts();
        toast('Product deleted');
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  // ---------- product editor ----------
  const form = $('productForm');

  function openEditor(product = null) {
    state.editing = product;
    state.images = product ? [...(product.images || [])] : [];
    $('editorTitle').textContent = product ? 'Edit product' : 'Add product';

    const cats = [...new Set([...(state.settings.categories || []), product?.category].filter(Boolean))];
    $('categorySelect').innerHTML = cats.map((c) => `<option>${escapeHtml(c)}</option>`).join('');

    form.reset();
    if (product) {
      form.name.value = product.name;
      form.category.value = product.category;
      form.price.value = product.price;
      form.salePrice.value = product.salePrice ?? '';
      form.description.value = product.description || '';
      form.sizes.value = (product.sizes || []).join(', ');
      form.colors.value = (product.colors || []).join(', ');
      form.onSale.checked = product.onSale;
      form.soldOut.checked = product.soldOut;
      form.featured.checked = product.featured;
    }
    renderImages();
    renderColorChips();
    form.trackStock.checked = Boolean(product?.trackStock);
    state.editStock = { ...(product?.stock || {}) };
    $('stockGrid').innerHTML = '';
    renderStockGrid();
    $('editor').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeEditor() {
    $('editor').hidden = true;
    document.body.style.overflow = '';
  }

  function renderImages() {
    $('imageList').innerHTML = state.images
      .map(
        (src, i) => `
      <div class="img-tile">
        <img src="${escapeHtml(src)}" alt="">
        ${i === 0 ? '<span class="cover">MAIN</span>' : ''}
        <div class="tile-actions">
          ${i === 0 ? '<span></span>' : `<button type="button" data-cover="${i}">Make main</button>`}
          <button type="button" data-remove-img="${i}">Remove</button>
        </div>
      </div>`
      )
      .join('');
  }

  // Colour chips: tap to add/remove a colour from the comma list
  const colorList = () => form.colors.value.split(',').map((c) => c.trim()).filter(Boolean);

  function renderColorChips() {
    const chosen = colorList().map((c) => c.toLowerCase());
    $('colorChips').innerHTML = Object.entries(COLOR_SWATCHES)
      .map(([name, bg]) => `<button type="button" class="color-chip${chosen.includes(name.toLowerCase()) ? ' on' : ''}" data-color="${escapeHtml(name)}"><span class="swatch" style="background:${bg}"></span>${escapeHtml(name)}</button>`)
      .join('');
  }

  $('colorChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-color]');
    if (!chip) return;
    const name = chip.dataset.color;
    const list = colorList();
    const i = list.findIndex((c) => c.toLowerCase() === name.toLowerCase());
    if (i === -1) list.push(name);
    else list.splice(i, 1);
    form.colors.value = list.join(', ');
    renderColorChips();
    renderStockGrid();
  });
  $('colorsInput').addEventListener('input', renderColorChips);

  $('imageList').addEventListener('click', (e) => {
    const cover = e.target.closest('[data-cover]');
    if (cover) {
      const [img] = state.images.splice(Number(cover.dataset.cover), 1);
      state.images.unshift(img);
    }
    const remove = e.target.closest('[data-remove-img]');
    if (remove) state.images.splice(Number(remove.dataset.removeImg), 1);
    renderImages();
  });

  // One picture per request, each made smaller first (the host accepts at most 4.5MB per request)
  async function uploadImages(files) {
    const urls = [];
    for (const file of files) {
      const body = new FormData();
      body.append('images', await shrinkImage(file));
      const { files: saved } = await api('/api/admin/upload', { method: 'POST', body });
      urls.push(...saved);
    }
    return urls;
  }

  $('imageInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    toast('Uploading…');
    try {
      const urls = await uploadImages(files);
      state.images.push(...urls);
      renderImages();
      toast(`${urls.length} picture(s) uploaded`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('editor').addEventListener('click', (e) => {
    if (e.target === $('editor') || e.target.closest('[data-close]')) closeEditor();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('editor').hidden) closeEditor();
    if (e.key === 'Escape' && !$('userEditor').hidden) closeUserEditor();
    if (e.key === 'Escape' && !$('staffEditor').hidden) closeStaffEditor();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const price = Number(form.price.value);
    const salePrice = form.salePrice.value === '' ? null : Number(form.salePrice.value);
    if (salePrice !== null && salePrice >= price) {
      toast('Sale price must be lower than the price', true);
      return;
    }
    const body = {
      name: form.name.value,
      category: form.category.value,
      price,
      salePrice,
      description: form.description.value,
      sizes: form.sizes.value,
      colors: form.colors.value,
      // Adding a sale price turns "On sale" on automatically
      onSale: form.onSale.checked || (salePrice !== null && !state.editing?.salePrice),
      soldOut: form.soldOut.checked,
      featured: form.featured.checked,
      trackStock: form.trackStock.checked,
      stock: form.trackStock.checked ? readStockGrid() : {},
      images: state.images,
    };
    $('saveProductBtn').disabled = true;
    try {
      if (state.editing) {
        const updated = await api(`/api/admin/products/${state.editing.id}`, { method: 'PUT', body });
        Object.assign(state.editing, updated);
      } else {
        state.products.unshift(await api('/api/admin/products', { method: 'POST', body }));
      }
      renderProducts();
      closeEditor();
      toast('Product saved');
    } catch (err) {
      toast(err.message, true);
    } finally {
      $('saveProductBtn').disabled = false;
    }
  });

  $('addProductBtn').addEventListener('click', () => openEditor());

  // ---------- settings ----------
  const settingsForm = $('settingsForm');

  function fillSettings() {
    const s = state.settings;
    const f = settingsForm;
    ['storeName', 'tagline', 'currency', 'announcement', 'heroTitle', 'heroSubtitle'].forEach((k) => (f[k].value = s[k] || ''));
    f.categories.value = (s.categories || []).join(', ');
    renderSlides();
    ['whatsapp', 'instagram', 'facebook', 'tiktok', 'youtube', 'email', 'phone'].forEach((k) => (f[k].value = s.social?.[k] || ''));
  }

  async function saveSettings(message = 'Settings saved') {
    const f = settingsForm;
    const body = {
      storeName: f.storeName.value,
      tagline: f.tagline.value,
      currency: f.currency.value,
      announcement: f.announcement.value,
      heroTitle: f.heroTitle.value,
      heroSubtitle: f.heroSubtitle.value,
      categories: f.categories.value,
      slides: state.settings.slides || [],
      sliderShape: state.settings.sliderShape || 'landscape',
      social: Object.fromEntries(['whatsapp', 'instagram', 'facebook', 'tiktok', 'youtube', 'email', 'phone'].map((k) => [k, f[k].value])),
    };
    try {
      state.settings = await api('/api/admin/settings', { method: 'PUT', body });
      fillSettings();
      toast(message);
    } catch (err) {
      toast(err.message, true);
    }
  }

  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings();
  });

  // ---------- home page slider ----------
  const SHAPES = {
    landscape: { ratio: 1920 / 820, size: '1920 × 820 px', minWidth: 1200, label: 'landscape' },
    portrait: { ratio: 1080 / 1350, size: '1080 × 1350 px', minWidth: 700, label: 'portrait' },
  };

  // Tells the admin when a picture will be cut a lot or look blurry in the chosen shape
  function slideAdvice(img) {
    const shape = SHAPES[state.settings.sliderShape === 'portrait' ? 'portrait' : 'landscape'];
    const { naturalWidth: w, naturalHeight: h } = img;
    const note = img.closest('.slide-card').querySelector('[data-slide-note]');
    const problems = [];
    const ratio = w / h;
    if (Math.abs(Math.log(ratio / shape.ratio)) > Math.log(1.35)) {
      problems.push(`This picture is ${ratio > 1.1 ? 'wide' : ratio < 0.9 ? 'tall' : 'square'}, but the slider is ${shape.label} — a big part will be cut off.`);
    }
    if (w < shape.minWidth) problems.push('This picture is small and may look blurry.');
    note.className = `slide-note${problems.length ? ' warn' : ''}`;
    note.textContent = `${w} × ${h} px. ${problems.length ? `${problems.join(' ')} Best size: ${shape.size}.` : 'Good size for this shape.'}`;
  }

  function renderSlides() {
    const slides = state.settings.slides || [];
    const shape = state.settings.sliderShape === 'portrait' ? 'portrait' : 'landscape';
    $('shapeOptions').querySelector(`[value=${shape}]`).checked = true;
    $('slideList').dataset.shape = shape;
    $('slideUpload').hidden = slides.length >= 6;
    $('slideList').innerHTML = slides.length
      ? slides
          .map(
            (s, i) => `
        <div class="slide-card" data-index="${i}">
          <div class="slide-thumb"><img src="${escapeHtml(s.image)}" alt=""></div>
          <div class="slide-fields">
            <label>Heading <small>Optional</small><input data-slide-field="title" maxlength="80" value="${escapeHtml(s.title)}"></label>
            <label>Text <small>Optional</small><input data-slide-field="subtitle" maxlength="160" value="${escapeHtml(s.subtitle)}"></label>
            <p class="slide-note" data-slide-note></p>
          </div>
          <div class="slide-actions">
            <button type="button" class="btn btn-sm btn-ghost" data-slide-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move left">←</button>
            <button type="button" class="btn btn-sm btn-ghost" data-slide-move="1" ${i === slides.length - 1 ? 'disabled' : ''} aria-label="Move right">→</button>
            <button type="button" class="btn btn-sm btn-ghost" data-slide-remove>Remove</button>
          </div>
        </div>`
          )
          .join('')
      : '<div class="empty">No slider pictures yet. The store shows the normal home page.</div>';
    $('slideList').querySelectorAll('.slide-thumb img').forEach((img) => {
      if (img.complete && img.naturalWidth) slideAdvice(img);
      else img.addEventListener('load', () => slideAdvice(img), { once: true });
    });
  }

  $('shapeOptions').addEventListener('change', (e) => {
    state.settings.sliderShape = e.target.value;
    saveSettings(e.target.value === 'portrait' ? 'Slider set to portrait' : 'Slider set to landscape');
  });

  $('slideInput').addEventListener('change', async (e) => {
    const files = [...e.target.files].slice(0, 6 - (state.settings.slides || []).length);
    e.target.value = '';
    if (!files.length) return;
    toast('Uploading…');
    try {
      const urls = await uploadImages(files);
      state.settings.slides = [...(state.settings.slides || []), ...urls.map((image) => ({ image, title: '', subtitle: '' }))];
      await saveSettings(`${urls.length} picture(s) added to the slider`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('slideList').addEventListener('click', (e) => {
    const card = e.target.closest('.slide-card');
    if (!card) return;
    const slides = state.settings.slides;
    const i = Number(card.dataset.index);
    const move = e.target.closest('[data-slide-move]');
    if (move) {
      const j = i + Number(move.dataset.slideMove);
      [slides[i], slides[j]] = [slides[j], slides[i]];
      saveSettings('Slider order saved');
    }
    if (e.target.closest('[data-slide-remove]') && confirm('Remove this picture from the slider?')) {
      slides.splice(i, 1);
      saveSettings('Picture removed');
    }
  });

  $('slideList').addEventListener('change', (e) => {
    const input = e.target.closest('[data-slide-field]');
    if (!input) return;
    state.settings.slides[Number(input.closest('.slide-card').dataset.index)][input.dataset.slideField] = input.value;
    saveSettings('Slider text saved');
  });

  // ---------- pages: About us, policies, Earn with us, size guide, location ----------
  const contentForm = $('contentForm');
  const PAGE_INFO = {
    about: 'Shown from “About us” in the footer.',
    shipping: 'Delivery areas, time and charges.',
    returns: 'Exchange and refund rules.',
    terms: 'Terms & conditions of buying from your store.',
    earn: 'Shown above the “Earn with us” form (name, city, email, mobile). Filled forms appear in the “Earn with us” tab.',
  };
  const TEXT_HELP = 'New line = new line. Empty line = new paragraph. Start lines with • or - for a list.';

  function imageBlock(path, src) {
    return `
      <div class="page-image" data-image="${path}">
        ${src ? `<img src="${escapeHtml(src)}" alt="">` : '<div class="page-image-empty">No picture</div>'}
        <div class="btn-row">
          <label class="btn btn-sm btn-ghost">${src ? 'Change picture' : '+ Add picture'}<input type="file" accept="image/*" hidden data-image-input="${path}"></label>
          ${src ? `<button type="button" class="btn btn-sm btn-ghost" data-image-remove="${path}">Remove</button>` : ''}
        </div>
      </div>`;
  }

  function renderContent() {
    const c = state.content;
    if (!c) return;
    const pagePanel = (key) => {
      const p = c.pages[key];
      return `
        <div class="panel">
          <h2>${escapeHtml(p.title)}</h2>
          <p class="hint">${PAGE_INFO[key]}</p>
          <label>Title <input data-content="pages.${key}.title" maxlength="80" value="${escapeHtml(p.title)}"></label>
          ${imageBlock(`pages.${key}.image`, p.image)}
          <label>Text <small>${TEXT_HELP}</small><textarea data-content="pages.${key}.text" rows="8" maxlength="8000">${escapeHtml(p.text)}</textarea></label>
        </div>`;
    };
    const pp = c.popup;
    contentForm.innerHTML = `
      <div class="panel panel-wide">
        <h2>Offer popup</h2>
        <p class="hint">A box that opens when someone visits the store — for a sale, new arrivals or free delivery. Each visitor sees it once a day (again if you change it).</p>
        <label class="switch"><input type="checkbox" data-content="popup.enabled"${pp.enabled ? ' checked' : ''}><span></span> Show the popup on the store</label>
        <div class="row">
          <div class="field-block">${imageBlock('popup.image', pp.image)}</div>
          <div class="field-block">
            <label>Heading <input data-content="popup.title" maxlength="80" value="${escapeHtml(pp.title)}"></label>
            <label>Text <textarea data-content="popup.text" rows="3" maxlength="400">${escapeHtml(pp.text)}</textarea></label>
            <div class="row">
              <label>Button text <small>Empty = no button</small><input data-content="popup.buttonText" maxlength="30" value="${escapeHtml(pp.buttonText)}"></label>
              <label>Button goes to <small>#shop, #about or a web link</small><input data-content="popup.buttonLink" maxlength="300" value="${escapeHtml(pp.buttonLink)}"></label>
            </div>
          </div>
        </div>
      </div>
      <div class="panel">
        <h2>Size guide</h2>
        <p class="hint">Customers see a “Size guide” link next to the sizes of every product. Write rows like <code>Size | Chest | Length</code> to show a table, or add a picture of your size chart.</p>
        ${imageBlock('sizeGuide.image', c.sizeGuide.image)}
        <label>Text <textarea data-content="sizeGuide.text" rows="9" maxlength="4000">${escapeHtml(c.sizeGuide.text)}</textarea></label>
      </div>
      <div class="panel">
        <h2>Shop location</h2>
        <p class="hint">Shown in the footer as “Visit our shop”. Leave the address empty to hide it.</p>
        <label>Shop address <textarea data-content="location.address" rows="3" maxlength="300" placeholder="Shop #12, Main Market, Gulberg, Lahore">${escapeHtml(c.location.address)}</textarea></label>
        <label>Google Maps link <small>Optional. In Google Maps open your shop → Share → Copy link</small><input data-content="location.mapLink" type="url" placeholder="https://maps.app.goo.gl/…" value="${escapeHtml(c.location.mapLink)}"></label>
        <label class="switch"><input type="checkbox" data-content="location.showMap"${c.location.showMap ? ' checked' : ''}><span></span> Show a small map in the footer</label>
      </div>
      ${['about', 'shipping', 'returns', 'terms', 'earn'].map(pagePanel).join('')}
      <div class="save-bar"><button class="btn btn-accent" type="submit">Save pages</button></div>`;
  }

  // Copies what is typed into state.content
  function readContent() {
    contentForm.querySelectorAll('[data-content]').forEach((el) => {
      const keys = el.dataset.content.split('.');
      const last = keys.pop();
      const target = keys.reduce((o, k) => o[k], state.content);
      target[last] = el.type === 'checkbox' ? el.checked : el.value;
    });
  }

  function setContentPath(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], state.content)[last] = value;
  }

  async function saveContent(message = 'Pages saved') {
    try {
      state.content = await api('/api/admin/content', { method: 'PUT', body: state.content });
      renderContent();
      toast(message);
    } catch (err) {
      toast(err.message, true);
    }
  }

  contentForm.addEventListener('submit', (e) => {
    e.preventDefault();
    readContent();
    saveContent();
  });

  contentForm.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-image-input]');
    if (!input || !input.files.length) return;
    readContent();
    toast('Uploading…');
    try {
      const [url] = await uploadImages([input.files[0]]);
      setContentPath(input.dataset.imageInput, url);
      await saveContent('Picture saved');
    } catch (err) {
      toast(err.message, true);
    }
  });

  contentForm.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-image-remove]');
    if (!remove || !confirm('Remove this picture?')) return;
    readContent();
    setContentPath(remove.dataset.imageRemove, '');
    saveContent('Picture removed');
  });

  // ---------- WhatsApp alerts (CallMeBot) ----------
  const notifyForm = $('notifyForm');

  async function loadNotify() {
    try {
      renderNotify(await api('/api/admin/notify'));
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderNotify(n) {
    notifyForm.phone.value = n.phone || '';
    notifyForm.apiKey.value = '';
    notifyForm.apiKey.placeholder = n.hasApiKey ? '•••••• (saved — type a new one to change)' : '123456';
    notifyForm.onOrder.checked = n.onOrder;
    notifyForm.onEarn.checked = n.onEarn;
    const on = Boolean(n.phone && n.hasApiKey);
    $('notifyStatus').textContent = on ? '● ON' : '● OFF';
    $('notifyStatus').classList.toggle('on', on);
    $('notifyRemoveBtn').hidden = !n.hasApiKey;
    $('notifyTestBtn').disabled = !on;
    $('notifyLast').textContent = n.lastTest
      ? `Last test ${new Date(n.lastTest.at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}: ${n.lastTest.ok ? 'sent ✓' : n.lastTest.error}`
      : '';
  }

  async function saveNotify(extra = {}) {
    const f = notifyForm;
    const n = await api('/api/admin/notify', {
      method: 'PUT',
      body: { phone: f.phone.value, apiKey: f.apiKey.value, onOrder: f.onOrder.checked, onEarn: f.onEarn.checked, ...extra },
    });
    renderNotify(n);
    return n;
  }

  notifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await saveNotify();
      toast('WhatsApp alerts saved');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('notifyTestBtn').addEventListener('click', async () => {
    const btn = $('notifyTestBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await api('/api/admin/notify/test', { method: 'POST' });
      toast('Test message sent — check your WhatsApp');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.textContent = 'Send test message';
      loadNotify();
    }
  });

  $('notifyRemoveBtn').addEventListener('click', async () => {
    if (!confirm('Remove the API key? WhatsApp alerts will stop.')) return;
    try {
      await saveNotify({ removeApiKey: true });
      toast('API key removed');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- collections ----------
  function renderCollections() {
    const byId = new Map(state.products.map((p) => [p.id, p]));
    $('collectionList').innerHTML = state.collections.length
      ? state.collections
          .map(
            (c, i) => `
        <div class="panel collection-card" data-index="${i}">
          <div class="row">
            <label>Name <input data-col="name" maxlength="60" value="${escapeHtml(c.name)}" placeholder="Eid Collection"></label>
            <label>Short line <small>Optional</small><input data-col="description" maxlength="200" value="${escapeHtml(c.description || '')}" placeholder="New arrivals for Eid"></label>
          </div>
          <label class="switch"><input type="checkbox" data-col="showOnHome"${c.showOnHome ? ' checked' : ''}><span></span> Show as a row on the home page</label>
          <div class="label">Products <small>${c.productIds.length} selected — tap to add or remove</small></div>
          <input type="search" class="col-search" placeholder="Search products…" data-col-search>
          <div class="col-products">
            ${state.products
              .map((p) => {
                const on = c.productIds.includes(p.id);
                const img = p.images?.[0];
                return `<button type="button" class="col-product${on ? ' on' : ''}" data-col-product="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name.toLowerCase())}">
                  ${img ? `<img src="${escapeHtml(img)}" alt="">` : `<span class="ph">${escapeHtml(p.name.charAt(0))}</span>`}<span>${escapeHtml(p.name)}</span>${on ? '<b>✓</b>' : ''}</button>`;
              })
              .join('')}
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-accent" data-col-save>Save collection</button>
            <button type="button" class="btn btn-ghost" data-col-delete>Delete collection</button>
          </div>
        </div>`
          )
          .join('')
      : '<div class="empty">No collections yet. Click “+ New collection”.</div>';
    // keep products in a collection that were deleted out of the count
    state.collections.forEach((c) => (c.productIds = c.productIds.filter((id) => byId.has(id))));
  }

  function readCollections() {
    document.querySelectorAll('.collection-card').forEach((card) => {
      const c = state.collections[Number(card.dataset.index)];
      card.querySelectorAll('[data-col]').forEach((el) => (c[el.dataset.col] = el.type === 'checkbox' ? el.checked : el.value));
    });
  }

  async function saveCollections(message = 'Collections saved') {
    try {
      state.collections = await api('/api/admin/collections', { method: 'PUT', body: { collections: state.collections } });
      renderCollections();
      toast(message);
    } catch (err) {
      toast(err.message, true);
    }
  }

  $('addCollectionBtn').addEventListener('click', () => {
    readCollections();
    state.collections.push({ name: '', description: '', showOnHome: true, productIds: [] });
    renderCollections();
    document.querySelector('.collection-card:last-child [data-col=name]').focus();
  });

  $('collectionList').addEventListener('click', (e) => {
    const card = e.target.closest('.collection-card');
    if (!card) return;
    const c = state.collections[Number(card.dataset.index)];
    const pick = e.target.closest('[data-col-product]');
    if (pick) {
      const id = pick.dataset.colProduct;
      c.productIds = c.productIds.includes(id) ? c.productIds.filter((x) => x !== id) : [...c.productIds, id];
      const on = c.productIds.includes(id);
      pick.classList.toggle('on', on);
      pick.querySelector('b')?.remove();
      if (on) pick.insertAdjacentHTML('beforeend', '<b>✓</b>');
      card.querySelector('.label small').textContent = `${c.productIds.length} selected — tap to add or remove`;
    }
    if (e.target.closest('[data-col-save]')) {
      readCollections();
      saveCollections();
    }
    if (e.target.closest('[data-col-delete]') && confirm(`Delete the collection "${c.name || 'untitled'}"? The products stay in the store.`)) {
      readCollections();
      state.collections.splice(Number(card.dataset.index), 1);
      saveCollections('Collection deleted');
    }
  });

  $('collectionList').addEventListener('input', (e) => {
    if (!e.target.matches('[data-col-search]')) return;
    const q = e.target.value.trim().toLowerCase();
    e.target.closest('.collection-card').querySelectorAll('[data-col-product]').forEach((b) => (b.hidden = q && !b.dataset.name.includes(q)));
  });

  // ---------- reviews ----------
  const REVIEW_LABELS = { pending: 'Waiting', approved: 'On the store', hidden: 'Hidden' };
  state.reviews = [];
  state.reviewFilter = 'pending';
  state.reviewSearch = '';

  async function loadReviews() {
    try {
      state.reviews = await api('/api/admin/reviews');
      renderReviews();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderReviews() {
    const all = state.reviews;
    const count = (st) => all.filter((r) => r.status === st).length;
    $('newReviewsBadge').textContent = count('pending');
    $('newReviewsBadge').hidden = !count('pending');
    const avg = all.filter((r) => r.status === 'approved');
    $('reviewStats').innerHTML = [
      [count('pending'), 'Waiting for approval'],
      [count('approved'), 'On the store'],
      [avg.length ? (avg.reduce((n, r) => n + r.rating, 0) / avg.length).toFixed(1) + ' ★' : '–', 'Average rating'],
      [all.length, 'All reviews'],
    ].map(([n, label]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join('');
    const q = state.reviewSearch.toLowerCase();
    const list = all.filter((r) => (state.reviewFilter === 'all' || r.status === state.reviewFilter) && (!q || `${r.productName} ${r.name} ${r.text}`.toLowerCase().includes(q)));
    $('reviewList').innerHTML = list.length
      ? list
          .map(
            (r) => `
        <div class="urow review-row status-${r.status}" data-id="${escapeHtml(r.id)}">
          <div class="avatar">${r.rating}★</div>
          <div>
            <div class="pname">${'★'.repeat(r.rating)}<span class="off">${'★'.repeat(5 - r.rating)}</span> ${escapeHtml(r.name)}${r.verified ? '<span class="badge-user">Verified buyer</span>' : ''}</div>
            <div class="pmeta">${escapeHtml(r.productName || 'Deleted product')} · ${new Date(r.createdAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            <div class="review-text">${escapeHtml(r.text)}</div>
          </div>
          <span class="review-status">${REVIEW_LABELS[r.status]}</span>
          <div class="pactions">
            ${r.status !== 'approved' ? '<button class="btn btn-sm btn-accent" data-review="approved">Approve</button>' : '<button class="btn btn-sm btn-ghost" data-review="hidden">Hide</button>'}
            <button class="btn btn-sm btn-ghost" data-review="delete">Delete</button>
          </div>
        </div>`
          )
          .join('')
      : `<div class="empty">${all.length ? 'No reviews here.' : 'No reviews yet. Customers can write one on any product.'}</div>`;
  }

  $('reviewList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-review]');
    if (!btn) return;
    const id = e.target.closest('.review-row').dataset.id;
    try {
      if (btn.dataset.review === 'delete') {
        if (!confirm('Delete this review?')) return;
        await api(`/api/admin/reviews/${id}`, { method: 'DELETE' });
        state.reviews = state.reviews.filter((r) => r.id !== id);
      } else {
        Object.assign(state.reviews.find((r) => r.id === id), await api(`/api/admin/reviews/${id}`, { method: 'PATCH', body: { status: btn.dataset.review } }));
      }
      renderReviews();
      toast(btn.dataset.review === 'approved' ? 'Review is on the store' : 'Updated');
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('reviewSearch').addEventListener('input', (e) => {
    state.reviewSearch = e.target.value.trim();
    renderReviews();
  });
  $('reviewFilter').addEventListener('change', (e) => {
    state.reviewFilter = e.target.value;
    renderReviews();
  });
  $('refreshReviewsBtn').addEventListener('click', loadReviews);

  // ---------- delivery charges ----------
  const deliveryForm = $('deliveryForm');

  function renderDelivery() {
    const d = state.delivery;
    deliveryForm.fee.value = d.fee || 0;
    deliveryForm.freeAbove.value = d.freeAbove || 0;
    $('cityFees').innerHTML = d.cityFees
      .map(
        (c, i) => `
      <div class="city-fee" data-index="${i}">
        <input data-city="city" maxlength="60" placeholder="City, e.g. Lahore" value="${escapeHtml(c.city)}" aria-label="City">
        <input data-city="fee" type="number" min="0" step="1" placeholder="Charge" value="${c.fee}" aria-label="Charge">
        <button type="button" class="btn btn-sm btn-ghost" data-city-remove aria-label="Remove">✕</button>
      </div>`
      )
      .join('');
  }

  function readCityFees() {
    state.delivery.cityFees = [...document.querySelectorAll('.city-fee')].map((row) => ({
      city: row.querySelector('[data-city=city]').value,
      fee: Number(row.querySelector('[data-city=fee]').value) || 0,
    }));
  }

  $('addCityFeeBtn').addEventListener('click', () => {
    readCityFees();
    state.delivery.cityFees.push({ city: '', fee: 0 });
    renderDelivery();
    document.querySelector('.city-fee:last-child [data-city=city]').focus();
  });
  $('cityFees').addEventListener('click', (e) => {
    const remove = e.target.closest('[data-city-remove]');
    if (!remove) return;
    readCityFees();
    state.delivery.cityFees.splice(Number(remove.closest('.city-fee').dataset.index), 1);
    renderDelivery();
  });
  deliveryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    readCityFees();
    try {
      state.delivery = await api('/api/admin/delivery', {
        method: 'PUT',
        body: { fee: Number(deliveryForm.fee.value) || 0, freeAbove: Number(deliveryForm.freeAbove.value) || 0, cityFees: state.delivery.cityFees },
      });
      renderDelivery();
      toast('Delivery charges saved');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- staff ----------
  const staffForm = $('staffForm');
  state.staff = [];
  state.permissionLabels = {};

  async function loadStaff() {
    try {
      const data = await api('/api/admin/staff');
      state.staff = data.staff;
      state.permissionLabels = data.permissions;
      renderStaff();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderStaff() {
    $('staffList').innerHTML = state.staff.length
      ? state.staff
          .map(
            (m) => `
        <div class="urow${m.active ? '' : ' is-blocked'}" data-id="${escapeHtml(m.id)}">
          <div class="avatar">${escapeHtml(m.name.slice(0, 2).toUpperCase())}</div>
          <div>
            <div class="pname">${escapeHtml(m.name)} <span class="pmeta">@${escapeHtml(m.username)}</span>${m.active ? '' : '<span class="badge-blocked">Cannot log in</span>'}</div>
            <div class="pmeta">${m.permissions.map((p) => escapeHtml((state.permissionLabels[p] || p).split(' (')[0])).join(' · ')}</div>
            <div class="pmeta">${m.lastLoginAt ? `Last login ${new Date(m.lastLoginAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Not logged in yet'}</div>
          </div>
          <div></div>
          <div class="pactions">
            <button class="btn btn-sm btn-dark" data-staff="edit">Edit</button>
            <button class="btn btn-sm btn-ghost" data-staff="delete">Delete</button>
          </div>
        </div>`
          )
          .join('')
      : '<div class="empty">No staff yet. Click “+ Add staff”.</div>';
  }

  function openStaffEditor(member = null) {
    state.editingStaff = member;
    staffForm.reset();
    $('staffEditorTitle').textContent = member ? 'Edit staff' : 'Add staff';
    $('staffPwHelp').textContent = member ? 'Leave empty to keep the current password (a new one logs them out)' : 'At least 8 characters';
    staffForm.name.value = member?.name || '';
    staffForm.username.value = member?.username || '';
    staffForm.active.checked = member ? member.active : true;
    $('staffPerms').innerHTML = Object.entries(state.permissionLabels)
      .map(([key, label]) => `<label class="switch"><input type="checkbox" value="${key}"${member?.permissions.includes(key) || (!member && key === 'orders') ? ' checked' : ''}><span></span> ${escapeHtml(label)}</label>`)
      .join('');
    $('staffEditor').hidden = false;
    document.body.style.overflow = 'hidden';
    staffForm.name.focus();
  }

  function closeStaffEditor() {
    $('staffEditor').hidden = true;
    document.body.style.overflow = '';
  }

  $('addStaffBtn').addEventListener('click', () => openStaffEditor());
  $('staffEditor').addEventListener('click', (e) => {
    if (e.target === $('staffEditor') || e.target.closest('[data-close]')) closeStaffEditor();
  });
  $('staffList').addEventListener('click', async (e) => {
    const action = e.target.closest('[data-staff]')?.dataset.staff;
    if (!action) return;
    const member = state.staff.find((m) => m.id === e.target.closest('.urow').dataset.id);
    if (action === 'edit') openStaffEditor(member);
    if (action === 'delete' && confirm(`Delete ${member.name}'s login?`)) {
      try {
        await api(`/api/admin/staff/${member.id}`, { method: 'DELETE' });
        state.staff = state.staff.filter((m) => m.id !== member.id);
        renderStaff();
        toast('Staff login deleted');
      } catch (err) {
        toast(err.message, true);
      }
    }
  });
  staffForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      id: state.editingStaff?.id,
      name: staffForm.name.value,
      username: staffForm.username.value,
      password: staffForm.password.value,
      active: staffForm.active.checked,
      permissions: [...$('staffPerms').querySelectorAll('input:checked')].map((i) => i.value),
    };
    $('saveStaffBtn').disabled = true;
    try {
      const saved = await api('/api/admin/staff', { method: 'POST', body });
      const i = state.staff.findIndex((m) => m.id === saved.id);
      if (i === -1) state.staff.push(saved);
      else state.staff[i] = saved;
      renderStaff();
      closeStaffEditor();
      toast(`Saved. ${saved.name} logs in with username "${saved.username}".`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      $('saveStaffBtn').disabled = false;
    }
  });

  // ---------- coupons ----------
  state.coupons = [];

  async function loadCoupons() {
    try {
      state.coupons = await api('/api/admin/coupons');
      renderCoupons();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderCoupons() {
    const today = new Date().toISOString().slice(0, 10);
    $('couponList').innerHTML = state.coupons.length
      ? state.coupons
          .map((c, i) => {
            const expired = c.expiresAt && c.expiresAt < today;
            const full = c.maxUses && c.used >= c.maxUses;
            const status = !c.active ? 'Off' : expired ? 'Expired' : full ? 'Used up' : 'Active';
            return `
        <div class="coupon-card${status === 'Active' ? '' : ' off'}" data-index="${i}">
          <label>Code <input data-cp="code" maxlength="30" value="${escapeHtml(c.code)}" placeholder="EID20"></label>
          <label>Discount <span class="cp-value"><select data-cp="type"><option value="percent"${c.type === 'percent' ? ' selected' : ''}>%</option><option value="fixed"${c.type === 'fixed' ? ' selected' : ''}>Rs</option></select><input data-cp="value" type="number" min="0" step="1" value="${c.value || ''}"></span></label>
          <label>Min. order (Rs) <input data-cp="minOrder" type="number" min="0" step="1" value="${c.minOrder || 0}"></label>
          <label>Last day <input data-cp="expiresAt" type="date" value="${escapeHtml(c.expiresAt || '')}"></label>
          <label>Max uses <input data-cp="maxUses" type="number" min="0" step="1" value="${c.maxUses || 0}"></label>
          <div class="cp-meta"><span class="cp-status">${status}</span><span>Used ${c.used || 0}${c.maxUses ? ` / ${c.maxUses}` : ''}</span></div>
          <label class="switch"><input type="checkbox" data-cp="active"${c.active !== false ? ' checked' : ''}><span></span> On</label>
          <button type="button" class="btn btn-sm btn-ghost" data-cp-remove>Delete</button>
        </div>`;
          })
          .join('')
      : '<div class="empty">No coupons yet. Click “+ New coupon”.</div>';
  }

  function readCoupons() {
    document.querySelectorAll('.coupon-card').forEach((card) => {
      const c = state.coupons[Number(card.dataset.index)];
      card.querySelectorAll('[data-cp]').forEach((el) => (c[el.dataset.cp] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) || 0 : el.value));
    });
  }

  $('addCouponBtn').addEventListener('click', () => {
    readCoupons();
    state.coupons.push({ code: '', type: 'percent', value: 10, minOrder: 0, expiresAt: '', maxUses: 0, used: 0, active: true });
    renderCoupons();
    document.querySelector('.coupon-card:last-child [data-cp=code]').focus();
  });
  $('couponList').addEventListener('click', (e) => {
    const remove = e.target.closest('[data-cp-remove]');
    if (!remove || !confirm('Delete this coupon? Customers can no longer use it.')) return;
    readCoupons();
    state.coupons.splice(Number(remove.closest('.coupon-card').dataset.index), 1);
    renderCoupons();
  });
  $('saveCouponsBtn').addEventListener('click', async () => {
    readCoupons();
    try {
      state.coupons = await api('/api/admin/coupons', { method: 'PUT', body: { coupons: state.coupons } });
      renderCoupons();
      toast('Coupons saved');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- sales report ----------
  const DAY = 24 * 3600 * 1000;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
  let chartAsTable = false;

  function reportPeriod() {
    const now = new Date();
    const r = $('reportRange').value;
    if (r === 'today') return { start: startOfDay(now), byMonth: false };
    if (r === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1), byMonth: false };
    if (r === 'all') {
      const first = state.orders.reduce((m, o) => Math.min(m, new Date(o.createdAt).getTime()), now.getTime());
      const start = startOfDay(new Date(first));
      return { start, byMonth: now - start > 62 * DAY };
    }
    return { start: startOfDay(new Date(now - (Number(r) - 1) * DAY)), byMonth: false };
  }

  function renderReport() {
    const { start, byMonth } = reportPeriod();
    const inRange = state.orders.filter((o) => new Date(o.createdAt) >= start);
    const sales = inRange.filter((o) => !LOST_STATUSES.includes(o.status));
    const total = sales.reduce((n, o) => n + o.total, 0);
    const items = sales.reduce((n, o) => n + o.items.reduce((m, i) => m + i.qty, 0), 0);
    const lost = inRange.length - sales.length;
    $('reportStats').innerHTML = [
      [money(total), 'Sales'],
      [sales.length, 'Orders'],
      [sales.length ? money(Math.round(total / sales.length)) : '–', 'Average order'],
      [items, 'Pieces sold'],
      [sales.filter((o) => o.status === 'delivered').length, 'Delivered'],
      [money(sales.filter((o) => o.paymentStatus === 'paid').reduce((n, o) => n + o.total, 0)), 'Payment received'],
      [lost, 'Cancelled / returned'],
      [sales.filter((o) => o.couponDiscount).length, 'Used a coupon'],
    ]
      .map(([n, label]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`)
      .join('');

    // One column per day (or per month for long periods), empty days included
    const buckets = [];
    const now = new Date();
    if (byMonth) {
      for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-PK', { month: 'short', year: '2-digit' }), value: 0, count: 0 });
      }
    } else {
      for (let d = new Date(start); d <= now; d = new Date(d.getTime() + DAY)) {
        buckets.push({ key: dayKey(d), label: d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }), value: 0, count: 0 });
      }
    }
    const index = new Map(buckets.map((b) => [b.key, b]));
    sales.forEach((o) => {
      const d = new Date(o.createdAt);
      const b = index.get(byMonth ? `${d.getFullYear()}-${d.getMonth()}` : dayKey(d));
      if (b) {
        b.value += o.total;
        b.count += 1;
      }
    });
    $('chartTitle').textContent = byMonth ? 'Sales per month' : 'Sales per day';
    drawColumns(buckets);

    const bars = (rows, fmt) => {
      const max = Math.max(1, ...rows.map((r) => r.value));
      return rows.length
        ? rows.map((r) => `<div class="bar-row"><span class="bar-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span><span class="bar-track"><span class="bar" style="width:${Math.max(2, (r.value / max) * 100)}%"></span></span><span class="bar-value">${fmt(r)}</span></div>`).join('')
        : '<div class="empty">No sales in this period.</div>';
    };
    const byProduct = new Map();
    sales.forEach((o) => o.items.forEach((i) => {
      const r = byProduct.get(i.name) || { label: i.name, value: 0, qty: 0 };
      r.value += i.price * i.qty;
      r.qty += i.qty;
      byProduct.set(i.name, r);
    }));
    $('topProducts').innerHTML = bars([...byProduct.values()].sort((a, b) => b.value - a.value).slice(0, 8), (r) => `${money(r.value)} <small>${r.qty} pcs</small>`);
    const byCity = new Map();
    sales.forEach((o) => {
      const name = (o.customer.city || '—').trim();
      const key = name.toLowerCase();
      const r = byCity.get(key) || { label: name, value: 0, total: 0 };
      r.value += 1;
      r.total += o.total;
      byCity.set(key, r);
    });
    $('topCities').innerHTML = bars([...byCity.values()].sort((a, b) => b.value - a.value).slice(0, 8), (r) => `${r.value} <small>${money(r.total)}</small>`);
  }

  // Column chart: one hue, thin columns with rounded tops, hairline grid, hover tooltip, table view
  function drawColumns(buckets) {
    const box = $('salesChart');
    if (chartAsTable) {
      box.innerHTML = `<div class="table-wrap"><table class="chart-table"><thead><tr><th>${buckets.length && buckets[0].key.length > 8 ? 'Day' : 'Month'}</th><th>Orders</th><th>Sales</th></tr></thead><tbody>${buckets
        .map((b) => `<tr><td>${escapeHtml(b.label)}</td><td>${b.count}</td><td>${money(b.value)}</td></tr>`)
        .join('')}</tbody></table></div>`;
      return;
    }
    const W = 800, H = 260, L = 48, R = 12, T = 12, B = 30;
    const max = Math.max(...buckets.map((b) => b.value), 0);
    const step = (() => {
      const raw = (max || 1000) / 4;
      const mag = 10 ** Math.floor(Math.log10(raw));
      return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw);
    })();
    const top = step * 4;
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const band = (W - L - R) / buckets.length;
    const bw = Math.min(24, band * 0.6);
    const every = Math.ceil(buckets.length / 10); // at most ~10 date labels
    const grid = [0, 1, 2, 3, 4]
      .map((i) => `<line x1="${L}" x2="${W - R}" y1="${y(step * i)}" y2="${y(step * i)}" class="grid${i ? '' : ' base'}"/><text x="${L - 6}" y="${y(step * i) + 4}" class="tick" text-anchor="end">${compact(step * i)}</text>`)
      .join('');
    const cols = buckets
      .map((b, i) => {
        const x = L + band * i + (band - bw) / 2;
        const h = (H - T - B) * (b.value / top);
        const r = Math.min(4, h);
        const yTop = H - B - h;
        const path = h > 0 ? `<path class="col" d="M${x},${H - B} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + bw - r} Q${x + bw},${yTop} ${x + bw},${yTop + r} V${H - B} Z"/>` : '';
        return `<g class="col-g" data-i="${i}">${path}<rect class="hit" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}"/>${i % every === 0 ? `<text x="${x + bw / 2}" y="${H - 10}" class="tick" text-anchor="middle">${escapeHtml(b.label)}</text>` : ''}</g>`;
      })
      .join('');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales per period">${grid}${cols}</svg><div class="chart-tip" hidden></div>`;
    const tip = box.querySelector('.chart-tip');
    box.querySelector('svg').addEventListener('pointermove', (e) => {
      const g = e.target.closest('.col-g');
      box.querySelectorAll('.col-g.on').forEach((x) => x !== g && x.classList.remove('on'));
      if (!g) return (tip.hidden = true);
      g.classList.add('on');
      const b = buckets[Number(g.dataset.i)];
      tip.innerHTML = `<b>${escapeHtml(b.label)}</b><span>${money(b.value)}</span><span>${b.count} order(s)</span>`;
      tip.hidden = false;
      const rect = box.getBoundingClientRect();
      tip.style.left = `${Math.min(e.clientX - rect.left + 12, rect.width - 150)}px`;
      tip.style.top = `${e.clientY - rect.top - 10}px`;
    });
    box.querySelector('svg').addEventListener('pointerleave', () => {
      tip.hidden = true;
      box.querySelectorAll('.col-g.on').forEach((x) => x.classList.remove('on'));
    });
  }

  $('reportRange').addEventListener('change', renderReport);
  $('refreshReportBtn').addEventListener('click', () => loadOrders().then(renderReport));
  $('chartTableBtn').addEventListener('click', () => {
    chartAsTable = !chartAsTable;
    $('chartTableBtn').textContent = chartAsTable ? 'Show as chart' : 'Show as table';
    renderReport();
  });

  // ---------- Earn with us forms ----------
  const EARN_LABELS = { new: 'New', contacted: 'Contacted', approved: 'Approved', rejected: 'Rejected' };

  async function loadApplications() {
    try {
      state.applications = await api('/api/admin/applications');
      renderApplications();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderApplications() {
    const all = state.applications;
    const count = (st) => all.filter((a) => a.status === st).length;
    $('newEarnBadge').textContent = count('new');
    $('newEarnBadge').hidden = !count('new');
    $('earnStats').innerHTML = [[all.length, 'Total forms'], [count('new'), 'New'], [count('contacted'), 'Contacted'], [count('approved'), 'Approved']]
      .map(([n, label]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`)
      .join('');
    const q = state.earnSearch.toLowerCase();
    const list = all.filter((a) => (state.earnFilter === 'all' || a.status === state.earnFilter) && (!q || `${a.name} ${a.city} ${a.email} ${a.phone}`.toLowerCase().includes(q)));
    $('earnList').innerHTML = list.length
      ? list
          .map((a) => {
            const wa = a.phone.replace(/\D/g, '').replace(/^0/, '92');
            return `
        <div class="urow earn-row" data-id="${escapeHtml(a.id)}">
          <div class="avatar">${escapeHtml(a.name.slice(0, 2).toUpperCase())}</div>
          <div>
            <div class="pname">${escapeHtml(a.name)} <span class="pmeta">· ${escapeHtml(a.city)}</span>${a.userId ? '<span class="badge-user">Registered</span>' : ''}</div>
            <div class="pmeta"><a href="tel:${escapeHtml(a.phone)}">${escapeHtml(a.phone)}</a> · <a href="https://wa.me/${escapeHtml(wa)}" target="_blank" rel="noopener">WhatsApp</a> · <a href="mailto:${escapeHtml(a.email)}">${escapeHtml(a.email)}</a></div>
            ${a.message ? `<div class="order-notes">${escapeHtml(a.message)}</div>` : ''}
            <div class="pmeta">${new Date(a.createdAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          </div>
          <select class="status-select" data-earn-status aria-label="Status">
            ${Object.entries(EARN_LABELS).map(([v, l]) => `<option value="${v}"${a.status === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          <div class="pactions"><button class="btn btn-sm btn-ghost" data-earn-delete>Delete</button></div>
        </div>`;
          })
          .join('')
      : `<div class="empty">${all.length ? 'No forms match.' : 'No forms yet. They appear here when someone fills “Earn with us”.'}</div>`;
  }

  $('earnList').addEventListener('change', async (e) => {
    if (!e.target.matches('[data-earn-status]')) return;
    const id = e.target.closest('.earn-row').dataset.id;
    try {
      const updated = await api(`/api/admin/applications/${id}`, { method: 'PATCH', body: { status: e.target.value } });
      Object.assign(state.applications.find((a) => a.id === id), updated);
      renderApplications();
      toast('Updated');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('earnList').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-earn-delete]')) return;
    const id = e.target.closest('.earn-row').dataset.id;
    if (!confirm('Delete this form?')) return;
    try {
      await api(`/api/admin/applications/${id}`, { method: 'DELETE' });
      state.applications = state.applications.filter((a) => a.id !== id);
      renderApplications();
      toast('Deleted');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('earnSearch').addEventListener('input', (e) => {
    state.earnSearch = e.target.value.trim();
    renderApplications();
  });
  $('earnFilter').addEventListener('change', (e) => {
    state.earnFilter = e.target.value;
    renderApplications();
  });
  $('refreshEarnBtn').addEventListener('click', loadApplications);

  $('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await changePassword(e.target);
      toast('Password updated — other devices are logged out');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- boot ----------
  api('/api/admin/me').then((me) => (me.mustChangePassword ? showForce() : showApp())).catch(showLogin);
})();
