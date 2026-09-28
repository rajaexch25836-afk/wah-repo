(() => {
  const $ = (id) => document.getElementById(id);
  const state = { settings: {}, products: [], payments: {}, accounts: {}, user: null, afterLogin: null, filter: 'all', query: '', sort: 'new', cart: [], step: 'bag' };

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

  // ---------- home page slider ----------
  const slider = { index: 0, timer: null };

  function renderSlider() {
    const slides = state.settings.slides || [];
    $('slider').hidden = !slides.length;
    $('hero').classList.toggle('has-slider', slides.length > 0);
    if (!slides.length) return;
    $('sliderTrack').innerHTML = slides
      .map(
        (s, i) => `
      <a class="slide" href="#shop" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}">
        <img src="${escapeHtml(s.image)}" alt="${escapeHtml(s.title || state.settings.storeName)}"${i ? ' loading="lazy"' : ''}>
        ${s.title || s.subtitle ? `<div class="slide-caption">${s.title ? `<h2>${escapeHtml(s.title)}</h2>` : ''}${s.subtitle ? `<p>${escapeHtml(s.subtitle)}</p>` : ''}</div>` : ''}
      </a>`
      )
      .join('');
    const many = slides.length > 1;
    $('sliderDots').innerHTML = many ? slides.map((_, i) => `<button data-slide="${i}" aria-label="Go to picture ${i + 1}"></button>`).join('') : '';
    $('slidePrev').hidden = $('slideNext').hidden = !many;
    updateDots();
    if (many) startAutoSlide();
  }

  function goToSlide(i) {
    const track = $('sliderTrack');
    const count = track.children.length;
    slider.index = (i + count) % count;
    track.scrollTo({ left: slider.index * track.clientWidth, behavior: 'smooth' });
  }

  function updateDots() {
    $('sliderDots').querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === slider.index));
  }

  function startAutoSlide() {
    clearInterval(slider.timer);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    slider.timer = setInterval(() => goToSlide(slider.index + 1), 5000);
  }

  // Swiping by hand updates the dots and restarts the timer
  $('sliderTrack').addEventListener('scroll', () => {
    const track = $('sliderTrack');
    const i = Math.round(track.scrollLeft / track.clientWidth);
    if (i !== slider.index) {
      slider.index = i;
      updateDots();
    }
  }, { passive: true });
  $('sliderTrack').addEventListener('touchstart', startAutoSlide, { passive: true });
  $('slidePrev').addEventListener('click', () => { goToSlide(slider.index - 1); startAutoSlide(); });
  $('slideNext').addEventListener('click', () => { goToSlide(slider.index + 1); startAutoSlide(); });
  $('sliderDots').addEventListener('click', (e) => {
    const dot = e.target.closest('[data-slide]');
    if (dot) { goToSlide(Number(dot.dataset.slide)); startAutoSlide(); }
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? clearInterval(slider.timer) : ($('sliderTrack').children.length > 1 && startAutoSlide())));

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
    if (details) {
      checkoutForm.scrollTop = 0;
      renderLoginHint();
      $('manualAmount').textContent = money(cartTotal());
    }
  }

  const cartTotal = () => cartLines().reduce((n, l) => n + l.qty * finalPrice(l.product), 0);

  function renderLoginHint() {
    const { requireLogin, allowRegistration } = state.accounts;
    $('loginHint').innerHTML = state.user
      ? ''
      : requireLogin
        ? `Please <button type="button" data-account="login">log in</button>${allowRegistration ? ' or <button type="button" data-account="register">create an account</button>' : ''} to place your order.`
        : `Have an account? <button type="button" data-account="login">Log in</button>${allowRegistration ? ' — or <button type="button" data-account="register">register</button> to track your orders' : ''}.`;
  }

  // ---------- payment options ----------
  const MANUAL_TYPE_LABELS = { bank: 'Bank transfer', easypaisa: 'Easypaisa', jazzcash: 'JazzCash', other: 'Other' };

  function renderPayOptions() {
    const p = state.payments;
    const manualTypes = [...new Set((p.manualAccounts || []).map((a) => (a.type === 'bank' ? 'Bank' : MANUAL_TYPE_LABELS[a.type])))];
    const options = [
      p.cod && ['cod', 'Cash on delivery', 'Pay when you receive your order'],
      p.manual && ['manual', `${manualTypes.join(' / ')} transfer`, 'Send the money yourself, then enter the transaction ID'],
      p.easypaisa && ['easypaisa', 'Easypaisa (instant)', 'Pay from your Easypaisa account on the Easypaisa page'],
      p.safepay && ['safepay', 'Pay online', 'Debit/credit card, bank account or wallet — secured by Safepay'],
    ].filter(Boolean);
    $('payOptions').innerHTML = options.length
      ? options
          .map(([value, title, help], i) => `<label class="pay-option"><input type="radio" name="paymentMethod" value="${value}"${i === 0 ? ' checked' : ''}><span><strong>${escapeHtml(title)}</strong><small>${help}</small></span></label>`)
          .join('')
      : '<p class="form-error">Ordering is paused right now. Please contact us.</p>';

    $('manualAccounts').innerHTML = (p.manualAccounts || [])
      .map((a, i) => {
        const copyRow = (label, value) =>
          value ? `<div class="acc-row">${label}: <code>${escapeHtml(value)}</code><button type="button" class="copy-btn" data-copy="${escapeHtml(value)}"><span class="icon">${ICONS.copy}</span>Copy</button></div>` : '';
        return `
        <label class="manual-account">
          <input type="radio" name="manualAccount" value="${escapeHtml(a.id)}"${i === 0 ? ' checked' : ''}>
          <span class="acc">
            <span class="acc-type">${MANUAL_TYPE_LABELS[a.type] || ''}</span>
            ${a.name ? `<strong>${escapeHtml(a.name)}</strong>` : ''}
            <span>Account title: <strong>${escapeHtml(a.accountTitle)}</strong></span>
            ${copyRow(a.type === 'bank' ? 'Account no.' : 'Number', a.accountNumber)}
            ${copyRow('IBAN', a.iban)}
            ${a.instructions ? `<span class="acc-note">${escapeHtml(a.instructions)}</span>` : ''}
          </span>
        </label>`;
      })
      .join('');
    updatePayMethod();
  }

  function updatePayMethod() {
    $('manualPay').hidden = checkoutForm.paymentMethod?.value !== 'manual';
  }

  function fillCheckoutFromUser() {
    if (!state.user) return;
    CUSTOMER_FIELDS.forEach((k) => state.user[k] && (checkoutForm[k].value = state.user[k]));
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
    if (f.paymentMethod?.value === 'manual') {
      checks.push([f.reference, f.reference.value.trim().length >= 4, 'Please enter the transaction ID (TID) of your payment']);
    }
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
    if (state.accounts.requireLogin && !state.user) {
      openAccount('login', 'checkout');
      return;
    }
    const f = checkoutForm;
    if (!f.paymentMethod) return;
    if (!validateCheckout()) return;
    const customer = Object.fromEntries([...CUSTOMER_FIELDS, 'notes'].map((k) => [k, f[k].value.trim()]));
    const paymentMethod = f.paymentMethod.value;
    const manual = paymentMethod === 'manual' ? { accountId: f.manualAccount.value, reference: f.reference.value.trim() } : undefined;
    try {
      localStorage.setItem('customer', JSON.stringify(Object.fromEntries(CUSTOMER_FIELDS.map((k) => [k, customer[k]]))));
    } catch {}

    const btn = $('placeOrderBtn');
    btn.disabled = true;
    btn.textContent = ['cod', 'manual'].includes(paymentMethod) ? 'Placing order…' : 'Taking you to payment…';
    $('checkoutError').textContent = '';
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer,
          paymentMethod,
          manual,
          items: cartLines().map((l) => ({ id: l.id, size: l.size, color: l.color, qty: l.qty })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not place your order. Please try again.');
      if (data.redirect) {
        // The bag is cleared only after the payment is confirmed
        window.location.href = data.redirect;
        return;
      }
      const receipt = manual && f.receipt.files[0];
      if (receipt) {
        const body = new FormData();
        body.append('receipt', receipt);
        const up = await fetch(`/api/orders/${data.order.id}/receipt?t=${data.accessToken}`, { method: 'POST', body }).catch(() => null);
        if (up?.ok) data.order.manualPayment.hasReceipt = true;
        else toast('Order placed, but the screenshot did not upload. Please send it on WhatsApp.');
      }
      state.cart = [];
      saveCart();
      ['notes', 'reference', 'receipt'].forEach((k) => (f[k].value = ''));
      closeOverlay($('cartDrawer'));
      showOrder(data.order);
    } catch (err) {
      $('checkoutError').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Place order';
    }
  }

  function paymentText(order) {
    const paid = order.paymentStatus === 'paid';
    if (order.paymentMethod === 'cod') return paid ? 'Paid (cash on delivery)' : 'Cash on delivery';
    if (order.paymentMethod === 'manual') {
      const label = order.manualPayment?.typeLabel || 'Transfer';
      return paid ? `Paid (${label})` : order.paymentStatus === 'failed' ? `${label} — not received` : `${label} — being checked`;
    }
    return paid ? `Paid (${order.paymentMethod === 'easypaisa' ? 'Easypaisa' : 'online'})` : 'Payment not completed';
  }

  function showOrder(order, paymentFailed = false) {
    const paid = order.paymentStatus === 'paid';
    const failed = paymentFailed || (!['cod', 'manual'].includes(order.paymentMethod) && !paid);
    const payText = paymentText(order);
    const waText = [
      `Hi ${state.settings.storeName}! I just placed order #${order.number}.`,
      '',
      ...order.items.map(
        (i, n) =>
          `${n + 1}. ${i.name}${i.size ? ` | Size: ${i.size}` : ''}${i.color ? ` | Colour: ${i.color}` : ''}\n   Qty: ${i.qty} × ${money(i.price)} = ${money(i.qty * i.price)}`
      ),
      '',
      `Total: ${money(order.total)}`,
      `Payment: ${payText}`,
      `Name: ${order.firstName}`,
    ].join('\n');
    $('orderBody').innerHTML = `
      <div class="check${failed ? ' warn' : ''}">${failed ? '!' : '✓'}</div>
      <h2 id="orderTitle">${failed ? 'Payment not completed' : `Thank you, ${escapeHtml(order.firstName)}!`}</h2>
      <p>${failed
        ? `We could not confirm the payment for order #${order.number}. If money was deducted, please contact us with your order number.`
        : order.paymentMethod === 'manual' && !paid
          ? `Your order <strong>#${order.number}</strong> has been placed. We will check your payment (TID ${escapeHtml(order.manualPayment?.reference || '')}) and confirm your order.`
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

  // Handles the return from Safepay/Easypaisa (/?order=…&t=…) and cancelled payments (/?payment=cancelled)
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

  // ---------- customer account ----------
  const ORDER_STATUS_LABELS = { new: 'Placed', confirmed: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned', rejected: 'Rejected', cancelled: 'Cancelled' };

  async function jsonFetch(url, body, method = 'POST') {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  function updateAccountUI() {
    $('accountName').textContent = state.user ? state.user.firstName : 'Log in';
    renderLoginHint();
  }

  const field = (label, name, attrs = '', value = '') =>
    `<label>${label} <input name="${name}" value="${escapeHtml(value)}" ${attrs}></label>`;

  // view: 'login' | 'register' | 'profile'. then: 'checkout' to go back to checkout after logging in.
  async function openAccount(view = state.user ? 'profile' : 'login', then = null) {
    if (then) state.afterLogin = then;
    if (view === 'register' && !state.accounts.allowRegistration) view = 'login';
    const body = $('accountBody');
    let orders = [];
    if (view === 'profile' && state.user) {
      // Always show fresh details (an order may have saved the address; the admin may have edited them)
      try {
        ({ user: state.user, orders } = await jsonFetch('/api/account', null, 'GET'));
      } catch {
        state.user = null; // logged out or blocked
        view = 'login';
      }
      updateAccountUI();
    }
    if (view === 'profile' && state.user) {
      const u = state.user;
      body.innerHTML = `
        <h2>Hi, ${escapeHtml(u.firstName)}</h2>
        <p>${escapeHtml(u.email)} · ${escapeHtml(u.phone)}</p>
        <h3>My orders</h3>
        <div class="my-orders">${renderMyOrders(orders)}</div>
        <h3>My details</h3>
        <form class="form-stack" data-form="profile" novalidate>
          <div class="field-row">${field('First name', 'firstName', 'maxlength="50" autocomplete="given-name"', u.firstName)}${field('Last name', 'lastName', 'maxlength="50" autocomplete="family-name"', u.lastName)}</div>
          ${field('Email', 'email', 'type="email" maxlength="120" autocomplete="email"', u.email)}
          ${field('Mobile number', 'phone', 'type="tel" maxlength="20" autocomplete="tel"', u.phone)}
          <label>Address <textarea name="address" rows="2" maxlength="300" autocomplete="street-address">${escapeHtml(u.address || '')}</textarea></label>
          ${field('City', 'city', 'maxlength="60" autocomplete="address-level2"', u.city)}
          <p class="form-error" data-error></p>
          <button class="btn btn-dark btn-block" type="submit">Save details</button>
        </form>
        <h3>Change password</h3>
        <form class="form-stack" data-form="password" novalidate>
          ${field('Current password', 'current', 'type="password" autocomplete="current-password"')}
          ${field('New password', 'next', 'type="password" minlength="6" autocomplete="new-password"')}
          <p class="form-error" data-error></p>
          <button class="btn btn-ghost btn-block" type="submit">Update password</button>
        </form>
        <button class="link-btn" data-logout>Log out</button>`;
      openOverlay($('accountModal'));
      return;
    }
    const tabs = state.accounts.allowRegistration
      ? `<div class="acc-tabs"><button type="button" class="${view === 'login' ? 'active' : ''}" data-account="login">Log in</button><button type="button" class="${view === 'register' ? 'active' : ''}" data-account="register">Create account</button></div>`
      : '';
    body.innerHTML =
      view === 'register'
        ? `<h2>Create account</h2>${tabs}
        <form class="form-stack" data-form="register" novalidate>
          <div class="field-row">${field('First name', 'firstName', 'maxlength="50" autocomplete="given-name"')}${field('Last name', 'lastName', 'maxlength="50" autocomplete="family-name"')}</div>
          ${field('Email', 'email', 'type="email" maxlength="120" autocomplete="email"')}
          ${field('Mobile number', 'phone', 'type="tel" maxlength="20" autocomplete="tel" placeholder="03001234567"')}
          ${field('Password <small>(at least 6 characters)</small>', 'password', 'type="password" minlength="6" autocomplete="new-password"')}
          <p class="form-error" data-error></p>
          <button class="btn btn-accent btn-block" type="submit">Create account</button>
        </form>`
        : `<h2>Welcome back</h2>${tabs}
        <form class="form-stack" data-form="login" novalidate>
          ${field('Email or mobile number', 'login', 'autocomplete="username"')}
          ${field('Password', 'password', 'type="password" autocomplete="current-password"')}
          <p class="form-error" data-error></p>
          <button class="btn btn-dark btn-block" type="submit">Log in</button>
        </form>`;
    openOverlay($('accountModal'));
    setTimeout(() => body.querySelector('input')?.focus(), 50);
  }

  function renderMyOrders(orders) {
    return orders.length
      ? orders
          .map(
            (o) => `
          <div class="my-order">
            <div class="top"><span>#${o.number}</span><span>${money(o.total)}</span></div>
            <div class="meta">${new Date(o.createdAt).toLocaleDateString('en-PK', { dateStyle: 'medium' })} · ${o.items.reduce((n, i) => n + i.qty, 0)} item(s)</div>
            <div><span class="status-pill">${ORDER_STATUS_LABELS[o.status] || o.status}</span> <span class="meta">${paymentText(o)}</span></div>
          </div>`
          )
          .join('')
      : '<p class="acc-note">No orders yet.</p>';
  }

  function afterLogin(user) {
    state.user = user;
    updateAccountUI();
    fillCheckoutFromUser();
    closeOverlay($('accountModal'));
    if (state.afterLogin === 'checkout') {
      state.afterLogin = null;
      openCart('details');
    }
  }

  $('accountBtn').addEventListener('click', () => {
    state.afterLogin = null;
    openAccount();
  });

  // "Log in" / "register" links anywhere on the page (checkout hint, modal tabs)
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-account]');
    if (!link) return;
    const fromCheckout = Boolean(link.closest('#checkoutForm'));
    if (fromCheckout) closeOverlay($('cartDrawer'));
    openAccount(link.dataset.account, fromCheckout ? 'checkout' : null);
  });

  $('accountBody').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-logout]')) return;
    await fetch('/api/account/logout', { method: 'POST' }).catch(() => {});
    state.user = null;
    updateAccountUI();
    closeOverlay($('accountModal'));
    toast('You are logged out');
  });

  $('accountBody').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form));
    const errorEl = form.querySelector('[data-error]');
    const btn = form.querySelector('[type=submit]');
    errorEl.textContent = '';
    btn.disabled = true;
    try {
      switch (form.dataset.form) {
        case 'login':
          afterLogin(await jsonFetch('/api/account/login', data));
          toast('Welcome back!');
          break;
        case 'register':
          afterLogin(await jsonFetch('/api/account/register', data));
          toast('Your account is ready');
          break;
        case 'profile':
          state.user = await jsonFetch('/api/account', data, 'PUT');
          updateAccountUI();
          fillCheckoutFromUser();
          toast('Details saved');
          break;
        case 'password':
          await jsonFetch('/api/account/password', data);
          form.reset();
          toast('Password updated');
          break;
      }
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

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
  checkoutForm.addEventListener('change', (e) => e.target.name === 'paymentMethod' && updatePayMethod());
  checkoutForm.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (!copy) return;
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      toast('Copied');
    } catch {
      toast(copy.dataset.copy);
    }
  });
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
      state.accounts = data.accounts || {};
      loadCart();
      prefillCustomer();
      renderPayOptions();
      renderSettings();
      renderSlider();
      renderChips();
      renderGrid();
      renderCart();
      return fetch('/api/account')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((account) => {
          state.user = account?.user || null;
          updateAccountUI();
          fillCheckoutFromUser();
          handleReturn();
        });
    })
    .catch(() => {
      $('grid').innerHTML = '<p class="empty">Could not load products. Please refresh.</p>';
    });
})();
