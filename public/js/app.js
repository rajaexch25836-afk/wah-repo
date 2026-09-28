(() => {
  const $ = (id) => document.getElementById(id);
  const state = { settings: {}, products: [], payments: {}, filter: 'all', query: '', sort: 'new', cart: [], step: 'bag' };

  const PLACEHOLDER_COLORS = ['#d9b99b', '#a8b596', '#c9a3a0', '#9fb3c2', '#d4b483', '#b7a4c9', '#c2562b', '#8a9a7b'];

  document.querySelectorAll('[data-icon]').forEach((el) => (el.innerHTML = ICONS[el.dataset.icon] || ''));

  // ---------- helpers ----------
  const money = (n) => `${state.settings.currency || 'Rs.'} ${Number(n).toLocaleString('en-PK')}`;
  const hasDiscount = (p) => p.onSale && p.salePrice != null && p.salePrice < p.price;
  const finalPrice = (p) => (hasDiscount(p) ? p.salePrice : p.price);
  const discount = (p) => (hasDiscount(p) ? Math.round((1 - p.salePrice / p.price) * 100) : 0);

  function placeholder(p) {
    let hash = 0;
    for (const ch of p.id + p.name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    const color = PLACEHOLDER_COLORS[Math.abs(hash) % PLACEHOLDER_COLORS.length];
    return `<div class="placeholder" style="background:${color}">${escapeHtml(p.name.charAt(0))}</div>`;
  }

  function media(p, index = 0) {
    const src = p.images && p.images[index];
    return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(p.name)}" loading="lazy">` : placeholder(p);
  }

  function priceHtml(p) {
    return hasDiscount(p)
      ? `<div class="price"><span class="now sale">${money(p.salePrice)}</span><span class="was">${money(p.price)}</span></div>`
      : `<div class="price"><span class="now">${money(p.price)}</span></div>`;
  }

  function badges(p) {
    const out = [];
    if (p.soldOut) out.push('<span class="badge sold">Sold out</span>');
    else if (p.onSale) out.push(`<span class="badge">${discount(p) ? `-${discount(p)}%` : 'Sale'}</span>`);
    if (p.featured && !p.soldOut) out.push('<span class="badge hot">Trending</span>');
    return out.length ? `<div class="badges">${out.join('')}</div>` : '';
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 2200);
  }

  function whatsappLink(text) {
    const number = state.settings.social?.whatsapp;
    return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
  }

  // ---------- settings / branding ----------
  function renderSettings() {
    const s = state.settings;
    document.title = `${s.storeName}${s.tagline ? ' — ' + s.tagline : ''}`;
    $('logo').textContent = s.storeName;
    $('footerLogo').textContent = s.storeName;
    $('footerName').textContent = s.storeName;
    $('year').textContent = new Date().getFullYear();
    $('tagline').textContent = s.tagline || '';
    $('footerTagline').textContent = s.tagline || '';
    $('heroSubtitle').textContent = s.heroSubtitle || '';

    // Last word of the hero title gets the accent colour
    const words = escapeHtml(s.heroTitle || s.storeName).split(' ');
    const last = words.pop();
    $('heroTitle').innerHTML = `${words.join(' ')} <em>${last}</em>`;

    if (s.announcement) {
      const items = s.announcement.split('•').map((t) => `<span>${escapeHtml(t.trim())}</span>`).join('');
      $('announceTrack').innerHTML = items + items; // duplicated for a seamless loop
      $('announce').hidden = false;
    }

    const links = socialLinks(s.social);
    const linkHtml = (withLabel) =>
      links
        .map((l) => `<a href="${escapeHtml(l.href)}" target="_blank" rel="noopener" aria-label="${l.label}" title="${l.label}"><span class="icon">${ICONS[l.key]}</span>${withLabel ? l.label : ''}</a>`)
        .join('');
    $('headerSocial').innerHTML = linkHtml(false);
    $('footerSocial').innerHTML = linkHtml(true) || '<p>Social links coming soon.</p>';

    if (s.social?.whatsapp) {
      $('waFloat').href = whatsappLink(`Hi ${s.storeName}! I have a question.`);
      $('waFloat').hidden = false;
    }

    // Hero images: use the first featured products that have pictures
    const withImages = state.products.filter((p) => p.images?.length && !p.soldOut);
    const heroPics = [...withImages.filter((p) => p.featured), ...withImages];
    if (heroPics[0]) $('heroCardA').style.backgroundImage = `url("${heroPics[0].images[0]}")`;
    if (heroPics[1]) $('heroCardB').style.backgroundImage = `url("${heroPics[1].images[0]}")`;
  }

  // ---------- product grid ----------
  function renderChips() {
    const cats = state.settings.categories || [];
    const chips = [['all', 'All'], ['sale', 'On sale'], ...cats.map((c) => [c, c])];
    $('chips').innerHTML = chips
      .map(([value, label]) => `<button class="chip${value === 'sale' ? ' sale' : ''}${state.filter === value ? ' active' : ''}" data-filter="${escapeHtml(value)}">${escapeHtml(label)}</button>`)
      .join('');
  }

  function visibleProducts() {
    const q = state.query.toLowerCase();
    let list = state.products.filter((p) => {
      if (state.filter === 'sale' && !p.onSale) return false;
      if (!['all', 'sale'].includes(state.filter) && p.category !== state.filter) return false;
      if (q && !`${p.name} ${p.category} ${p.description} ${(p.colors || []).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const sorters = {
      new: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
      low: (a, b) => finalPrice(a) - finalPrice(b),
      high: (a, b) => finalPrice(b) - finalPrice(a),
      sale: (a, b) => discount(b) - discount(a),
    };
    list = list.sort(sorters[state.sort]);
    // Sold-out items always go to the end
    return list.sort((a, b) => Number(a.soldOut) - Number(b.soldOut));
  }

  function renderGrid() {
    const list = visibleProducts();
    $('empty').hidden = list.length > 0;
    $('grid').innerHTML = list
      .map(
        (p) => `
        <button class="card${p.soldOut ? ' sold' : ''}" data-id="${escapeHtml(p.id)}">
          <div class="card-media">${media(p)}${badges(p)}<span class="card-quick">${p.soldOut ? 'Sold out' : 'Quick view'}</span></div>
          <div class="card-info">
            <div class="card-cat">${escapeHtml(p.category)}</div>
            <div class="card-name">${escapeHtml(p.name)}</div>
            ${priceHtml(p)}
          </div>
        </button>`
      )
      .join('');
  }

  // ---------- product modal ----------
  function openProduct(id) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    const pick = { size: p.sizes?.[0] || '', color: p.colors?.[0] || '', qty: 1 };
    const optGroup = (label, key, values) =>
      values?.length
        ? `<div><div class="opt-label">${label}</div><div class="opts">${values
            .map((v, i) => `<button class="opt${i === 0 ? ' active' : ''}" data-opt="${key}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`)
            .join('')}</div></div>`
        : '';
    const thumbs = (p.images || []).length > 1
      ? `<div class="thumbs">${p.images.map((src, i) => `<button class="${i === 0 ? 'active' : ''}" data-thumb="${i}"><img src="${escapeHtml(src)}" alt=""></button>`).join('')}</div>`
      : '';

    $('productBody').innerHTML = `
      <div class="gallery">
        <div class="gallery-main" id="galleryMain">${media(p)}</div>
        ${thumbs}
      </div>
      <div class="detail">
        <div class="card-cat">${escapeHtml(p.category)}</div>
        <h2>${escapeHtml(p.name)}</h2>
        ${priceHtml(p)}
        ${p.soldOut ? '<span class="badge sold" style="align-self:flex-start">Sold out</span>' : hasDiscount(p) ? `<span class="badge" style="align-self:flex-start">Save ${discount(p)}%</span>` : ''}
        ${p.description ? `<p class="desc">${escapeHtml(p.description)}</p>` : ''}
        ${optGroup('Size', 'size', p.sizes)}
        ${optGroup('Colour', 'color', p.colors)}
        ${p.soldOut ? '' : `<div><div class="opt-label">Quantity</div><div class="qty"><button data-qty="-1" aria-label="Less">−</button><span id="qtyVal">1</span><button data-qty="1" aria-label="More">+</button></div></div>`}
        <div class="detail-actions">
          <button class="btn btn-dark btn-block" id="addBtn" ${p.soldOut ? 'disabled' : ''}>${p.soldOut ? 'Sold out' : 'Add to bag'}</button>
          ${p.soldOut
            ? state.settings.social?.whatsapp ? `<button class="btn btn-wa btn-block" id="askBtn"><span class="icon">${ICONS.whatsapp}</span> Ask when it’s back</button>` : ''
            : '<button class="btn btn-accent btn-block" id="buyNowBtn">Buy now</button>'}
        </div>
      </div>`;

    const body = $('productBody');
    body.onclick = (e) => {
      const opt = e.target.closest('[data-opt]');
      if (opt) {
        pick[opt.dataset.opt] = opt.dataset.value;
        body.querySelectorAll(`[data-opt="${opt.dataset.opt}"]`).forEach((b) => b.classList.toggle('active', b === opt));
      }
      const thumb = e.target.closest('[data-thumb]');
      if (thumb) {
        $('galleryMain').innerHTML = media(p, Number(thumb.dataset.thumb));
        body.querySelectorAll('[data-thumb]').forEach((b) => b.classList.toggle('active', b === thumb));
      }
      const qty = e.target.closest('[data-qty]');
      if (qty) {
        pick.qty = Math.max(1, Math.min(20, pick.qty + Number(qty.dataset.qty)));
        $('qtyVal').textContent = pick.qty;
      }
      if (e.target.closest('#addBtn')) {
        addToCart(p, pick);
        closeOverlay($('productModal'));
        toast('Added to your bag');
      }
      if (e.target.closest('#buyNowBtn')) {
        addToCart(p, pick);
        closeOverlay($('productModal'));
        openCart('details');
      }
      if (e.target.closest('#askBtn')) {
        window.open(whatsappLink(`Hi! Is "${p.name}" coming back in stock?`), '_blank', 'noopener');
      }
    };
    openOverlay($('productModal'));
  }

  // ---------- cart ----------
  function loadCart() {
    try {
      state.cart = JSON.parse(localStorage.getItem('cart') || '[]');
    } catch {
      state.cart = [];
    }
  }

  function saveCart() {
    try {
      localStorage.setItem('cart', JSON.stringify(state.cart));
    } catch {}
    renderCart();
  }

  function addToCart(p, pick) {
    const existing = state.cart.find((l) => l.id === p.id && l.size === pick.size && l.color === pick.color);
    if (existing) existing.qty += pick.qty;
    else state.cart.push({ id: p.id, size: pick.size, color: pick.color, qty: pick.qty });
    saveCart();
  }

  function cartLines() {
    // Drop items that were deleted or sold out since they were added
    return state.cart
      .map((l) => ({ ...l, product: state.products.find((p) => p.id === l.id) }))
      .filter((l) => l.product && !l.product.soldOut);
  }

  function renderCart() {
    const lines = cartLines();
    const count = lines.reduce((n, l) => n + l.qty, 0);
    const total = lines.reduce((n, l) => n + l.qty * finalPrice(l.product), 0);
    $('cartCount').textContent = count;
    $('cartTotal').textContent = money(total);
    $('checkoutBtn').disabled = !lines.length;
    if (!lines.length && state.step === 'details') setStep('bag');
    $('cartItems').innerHTML = lines.length
      ? lines
          .map(
            (l, i) => `
          <div class="line">
            <div class="line-img">${media(l.product)}</div>
            <div>
              <div class="line-name">${escapeHtml(l.product.name)}</div>
              <div class="line-meta">${[l.size, l.color].filter(Boolean).map(escapeHtml).join(' · ')}${l.size || l.color ? ' · ' : ''}Qty ${l.qty}</div>
              <button class="line-remove" data-remove="${i}">Remove</button>
            </div>
            <strong>${money(l.qty * finalPrice(l.product))}</strong>
          </div>`
          )
          .join('')
      : '<p class="empty">Your bag is empty.</p>';
  }

  // ---------- checkout ----------
  const checkoutForm = $('checkoutForm');
  const CUSTOMER_FIELDS = ['firstName', 'lastName', 'phone', 'email', 'address', 'city'];

  function setStep(step) {
    state.step = step;
    const details = step === 'details';
    $('drawerTitle').textContent = details ? 'Checkout' : 'Your bag';
    $('cartItems').hidden = details;
    checkoutForm.hidden = !details;
    $('checkoutBtn').hidden = details;
    $('placeOrderBtn').hidden = !details;
    $('checkoutError').textContent = '';
    if (details) checkoutForm.scrollTop = 0;
  }

  function openCart(step = 'bag') {
    setStep(cartLines().length ? step : 'bag');
    openOverlay($('cartDrawer'));
    if (state.step === 'details') setTimeout(() => checkoutForm.firstName.focus(), 50);
  }

  function prefillCustomer() {
    try {
      const saved = JSON.parse(localStorage.getItem('customer') || '{}');
      CUSTOMER_FIELDS.forEach((k) => saved[k] && (checkoutForm[k].value = saved[k]));
    } catch {}
  }

  function validateCheckout() {
    const f = checkoutForm;
    const checks = [
      [f.firstName, f.firstName.value.trim(), 'Please enter your first name'],
      [f.lastName, f.lastName.value.trim(), 'Please enter your last name'],
      [f.phone, /^\+?[\d\s-]{10,20}$/.test(f.phone.value.trim()) && f.phone.value.replace(/\D/g, '').length >= 10, 'Please enter a valid contact number'],
      [f.email, !f.email.value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim()), 'Please enter a valid email or leave it empty'],
      [f.address, f.address.value.trim().length >= 10, 'Please enter your full address (house, street, area)'],
      [f.city, f.city.value.trim(), 'Please enter your city'],
    ];
    checks.forEach(([el]) => el.classList.remove('invalid'));
    const failed = checks.find(([, ok]) => !ok);
    if (!failed) return true;
    failed[0].classList.add('invalid');
    failed[0].focus();
    $('checkoutError').textContent = failed[2];
    return false;
  }

  async function placeOrder(e) {
    e.preventDefault();
    if (!validateCheckout()) return;
    const f = checkoutForm;
    const customer = Object.fromEntries([...CUSTOMER_FIELDS, 'notes'].map((k) => [k, f[k].value.trim()]));
    const paymentMethod = f.paymentMethod.value;
    try {
      localStorage.setItem('customer', JSON.stringify(Object.fromEntries(CUSTOMER_FIELDS.map((k) => [k, customer[k]]))));
    } catch {}

    const btn = $('placeOrderBtn');
    btn.disabled = true;
    btn.textContent = paymentMethod === 'safepay' ? 'Taking you to payment…' : 'Placing order…';
    $('checkoutError').textContent = '';
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer,
          paymentMethod,
          items: cartLines().map((l) => ({ id: l.id, size: l.size, color: l.color, qty: l.qty })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not place your order. Please try again.');
      if (data.redirect) {
        // The bag is cleared only after Safepay confirms the payment
        window.location.href = data.redirect;
        return;
      }
      state.cart = [];
      saveCart();
      f.notes.value = '';
      closeOverlay($('cartDrawer'));
      showOrder(data.order);
    } catch (err) {
      $('checkoutError').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Place order';
    }
  }

  function showOrder(order, paymentFailed = false) {
    const paid = order.paymentStatus === 'paid';
    const failed = paymentFailed || (order.paymentMethod === 'safepay' && !paid);
    const payText = order.paymentMethod === 'cod' ? 'Cash on delivery' : paid ? 'Paid online' : 'Payment not completed';
    const waText = `Hi ${state.settings.storeName}! I just placed order #${order.number} (${money(order.total)}).`;
    $('orderBody').innerHTML = `
      <div class="check${failed ? ' warn' : ''}">${failed ? '!' : '✓'}</div>
      <h2 id="orderTitle">${failed ? 'Payment not completed' : `Thank you, ${escapeHtml(order.firstName)}!`}</h2>
      <p>${failed
        ? `We could not confirm the payment for order #${order.number}. If money was deducted, please contact us with your order number.`
        : `Your order <strong>#${order.number}</strong> has been placed. We will call you to confirm it.`}</p>
      <div class="order-summary">
        ${order.items.map((i) => `<div><span>${i.qty} × ${escapeHtml(i.name)}${i.size ? ` (${escapeHtml(i.size)})` : ''}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}
        <div class="sum-total"><span>Total</span><span>${money(order.total)}</span></div>
        <div><span>Payment</span><span>${payText}</span></div>
      </div>
      ${state.settings.social?.whatsapp ? `<a class="btn btn-wa btn-block" href="${escapeHtml(whatsappLink(waText))}" target="_blank" rel="noopener"><span class="icon">${ICONS.whatsapp}</span> Message us on WhatsApp</a>` : ''}
      <button class="btn btn-dark btn-block" data-close>Continue shopping</button>`;
    openOverlay($('orderModal'));
  }

  // Handles the return from Safepay (/?order=…&t=…) and cancelled payments (/?payment=cancelled)
  async function handleReturn() {
    const params = new URLSearchParams(location.search);
    if (!params.has('order') && !params.has('payment')) return;
    history.replaceState(null, '', location.pathname);
    if (params.get('payment') === 'cancelled') {
      toast('Payment cancelled — your bag is still here');
      openCart('details');
      return;
    }
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(params.get('order'))}?t=${encodeURIComponent(params.get('t') || '')}`);
      if (!res.ok) return;
      const order = await res.json();
      if (order.paymentStatus === 'paid') {
        state.cart = [];
        saveCart();
      }
      showOrder(order, params.get('payment') === 'failed');
    } catch {}
  }

  // ---------- overlays ----------
  function openOverlay(el) {
    el.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeOverlay(el) {
    el.hidden = true;
    document.body.style.overflow = '';
  }
  document.querySelectorAll('.overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) closeOverlay(overlay);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.overlay:not([hidden])').forEach(closeOverlay);
  });

  // ---------- events ----------
  $('chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    renderChips();
    renderGrid();
  });
  document.querySelector('[data-jump="sale"]').addEventListener('click', () => {
    state.filter = 'sale';
    renderChips();
    renderGrid();
  });
  $('search').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    renderGrid();
    if (state.query) $('shop').scrollIntoView({ behavior: 'smooth' });
  });
  $('sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderGrid();
  });
  $('grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openProduct(card.dataset.id);
  });
  $('cartBtn').addEventListener('click', () => openCart());
  $('cartItems').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const line = cartLines()[Number(btn.dataset.remove)];
    state.cart = state.cart.filter((l) => !(l.id === line.id && l.size === line.size && l.color === line.color));
    saveCart();
  });
  $('checkoutBtn').addEventListener('click', () => {
    setStep('details');
    checkoutForm.firstName.focus();
  });
  $('backToBag').addEventListener('click', () => setStep('bag'));
  checkoutForm.addEventListener('submit', placeOrder);
  checkoutForm.addEventListener('input', (e) => {
    e.target.classList.remove('invalid');
    $('checkoutError').textContent = '';
  });

  // ---------- boot ----------
  fetch('/api/store')
    .then((r) => r.json())
    .then((data) => {
      state.settings = data.settings;
      state.products = data.products;
      state.payments = data.payments || {};
      $('payOnline').hidden = !state.payments.online;
      loadCart();
      prefillCustomer();
      renderSettings();
      renderChips();
      renderGrid();
      renderCart();
      handleReturn();
    })
    .catch(() => {
      $('grid').innerHTML = '<p class="empty">Could not load products. Please refresh.</p>';
    });
})();
