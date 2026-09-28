(() => {
  const $ = (id) => document.getElementById(id);
  const state = { settings: {}, products: [], editing: null, images: [], search: '', filter: 'all' };

  document.querySelectorAll('[data-icon]').forEach((el) => (el.innerHTML = ICONS[el.dataset.icon] || ''));

  // ---------- helpers ----------
  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      body: options.body instanceof FormData ? options.body : options.body && JSON.stringify(options.body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.endsWith('/login')) showLogin();
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
  function showLogin() {
    $('appView').hidden = true;
    $('loginView').hidden = false;
    $('loginPassword').focus();
  }

  async function showApp() {
    const data = await api('/api/store');
    state.settings = data.settings;
    state.products = data.products;
    $('loginView').hidden = true;
    $('appView').hidden = false;
    renderProducts();
    fillSettings();
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginError').textContent = '';
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: $('loginPassword').value } });
      $('loginPassword').value = '';
      showApp();
    } catch (err) {
      $('loginError').textContent = err.message;
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' });
    showLogin();
  });

  // ---------- tabs ----------
  document.querySelectorAll('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('tab-products').hidden = tab.dataset.tab !== 'products';
      $('tab-settings').hidden = tab.dataset.tab !== 'settings';
    })
  );

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

  $('imageInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const body = new FormData();
    files.forEach((f) => body.append('images', f));
    toast('Uploading…');
    try {
      const { files: urls } = await api('/api/admin/upload', { method: 'POST', body });
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
    ['whatsapp', 'instagram', 'facebook', 'tiktok', 'youtube', 'email', 'phone'].forEach((k) => (f[k].value = s.social?.[k] || ''));
  }

  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = settingsForm;
    const body = {
      storeName: f.storeName.value,
      tagline: f.tagline.value,
      currency: f.currency.value,
      announcement: f.announcement.value,
      heroTitle: f.heroTitle.value,
      heroSubtitle: f.heroSubtitle.value,
      categories: f.categories.value,
      social: Object.fromEntries(['whatsapp', 'instagram', 'facebook', 'tiktok', 'youtube', 'email', 'phone'].map((k) => [k, f[k].value])),
    };
    try {
      state.settings = await api('/api/admin/settings', { method: 'PUT', body });
      fillSettings();
      toast('Settings saved');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/admin/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
      f.reset();
      toast('Password updated');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- boot ----------
  api('/api/admin/me').then(showApp).catch(showLogin);
})();
