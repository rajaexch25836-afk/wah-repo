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

  async function showApp() {
    const data = await api('/api/store');
    state.settings = data.settings;
    state.products = data.products;
    $('loginView').hidden = true;
    $('appView').hidden = false;
    state.accountSettings = data.accounts || {};
    state.content = data.content;
    renderProducts();
    fillSettings();
    renderContent();
    loadApplications();
    loadNotify();
    loadOrders();
    loadUsers();
    loadPaymentSettings();
    loadSecurity();
  }

  const afterLogin = (res) => (res.mustChangePassword ? showForce() : showApp());

  let loginTicket = null;
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginError').textContent = '';
    try {
      const res = await api('/api/admin/login', { method: 'POST', body: { password: $('loginPassword').value } });
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
      ['orders', 'products', 'customers', 'payments', 'settings', 'pages', 'earn', 'security'].forEach((name) => ($(`tab-${name}`).hidden = tab.dataset.tab !== name));
      if (tab.dataset.tab === 'security') loadSecurity();
      if (tab.dataset.tab === 'earn') loadApplications();
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

    const q = state.orderSearch.toLowerCase();
    const list = all.filter((o) => {
      if (state.orderFilter !== 'all' && o.status !== state.orderFilter) return false;
      const c = o.customer;
      return !q || `#${o.number} ${o.number} ${c.firstName} ${c.lastName} ${c.phone} ${c.city} ${c.email} ${o.manualPayment?.reference || ''}`.toLowerCase().includes(q);
    });

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
            </header>
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
          <div class="ustats"><b>${u.orderCount} order(s)</b>${money(u.spent)}</div>
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
    $('saveUserBtn').disabled = true;
    try {
      await saveUser(state.editingUser, changes);
      closeUserEditor();
      toast('Customer saved');
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
    ].map(([n, label]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join('');

    const q = state.search.toLowerCase();
    const list = all.filter((p) => {
      if (state.filter === 'sale' && !p.onSale) return false;
      if (state.filter === 'sold' && !p.soldOut) return false;
      if (state.filter === 'available' && p.soldOut) return false;
      return !q || `${p.name} ${p.category}`.toLowerCase().includes(q);
    });

    $('productList').innerHTML = list.length
      ? list
          .map((p) => {
            const img = p.images?.[0];
            const hasDiscount = p.onSale && p.salePrice != null;
            return `
          <div class="prow${p.soldOut ? ' is-sold' : ''}" data-id="${escapeHtml(p.id)}">
            <div class="pthumb" style="${img ? '' : 'background:#c9a3a0'}">${img ? `<img src="${escapeHtml(img)}" alt="">` : escapeHtml(p.name.charAt(0))}</div>
            <div>
              <div class="pname">${escapeHtml(p.name)}</div>
              <div class="pmeta">${escapeHtml(p.category || 'No category')} · ${p.images?.length || 0} picture(s)</div>
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
    contentForm.innerHTML = `
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
