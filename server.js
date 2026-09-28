const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

// Safepay (online payments). Keys come from the Safepay merchant dashboard > Developers.
const SAFEPAY = {
  env: process.env.SAFEPAY_ENV === 'production' ? 'production' : 'sandbox',
  apiKey: process.env.SAFEPAY_API_KEY || '',
  secretKey: process.env.SAFEPAY_SECRET_KEY || '',
};
SAFEPAY.enabled = Boolean(SAFEPAY.apiKey && SAFEPAY.secretKey);
SAFEPAY.apiUrl = SAFEPAY.env === 'production' ? 'https://api.getsafepay.com' : 'https://sandbox.api.getsafepay.com';
SAFEPAY.checkoutUrl =
  SAFEPAY.env === 'production' ? 'https://getsafepay.com/checkout/pay' : 'https://sandbox.api.getsafepay.com/checkout/pay';

// Easypaisa (Easypay hosted checkout). Credentials come from the Easypaisa merchant portal.
// Username/password/account number are needed to confirm payments with Easypaisa's inquiry API,
// because the result Easypaisa sends back to the browser is not signed.
const EASYPAISA = {
  env: process.env.EASYPAISA_ENV === 'production' ? 'production' : 'sandbox',
  storeId: process.env.EASYPAISA_STORE_ID || '',
  hashKey: process.env.EASYPAISA_HASH_KEY || '',
  username: process.env.EASYPAISA_USERNAME || '',
  password: process.env.EASYPAISA_PASSWORD || '',
  accountNum: process.env.EASYPAISA_ACCOUNT_NUM || '',
};
EASYPAISA.enabled = Boolean(
  EASYPAISA.storeId && [16, 24, 32].includes(Buffer.byteLength(EASYPAISA.hashKey)) &&
    EASYPAISA.username && EASYPAISA.password && EASYPAISA.accountNum
);
EASYPAISA.baseUrl = EASYPAISA.env === 'production' ? 'https://easypay.easypaisa.com.pk' : 'https://easypaystg.easypaisa.com.pk';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Storage ----------

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    seed.admin = { passwordHash: hashPassword(DEFAULT_PASSWORD) };
    seed.orders = [];
    seed.nextOrderNumber = 1001;
    writeStore(seed);
    return seed;
  }
  const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  data.orders ||= [];
  data.nextOrderNumber ||= 1001;
  return data;
}

function writeStore(data) {
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

let store = loadStore();

function save() {
  writeStore(store);
}

// ---------- Helpers ----------

function str(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function list(value, max = 30) {
  const arr = Array.isArray(value) ? value : String(value || '').split(',');
  return arr.map((v) => str(String(v), 60)).filter(Boolean).slice(0, max);
}

function safeUrl(value) {
  const v = str(value, 300);
  if (!v) return '';
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

function sanitizeProduct(input, existing = {}) {
  const price = num(input.price);
  const salePrice = input.salePrice === '' || input.salePrice == null ? null : num(input.salePrice);
  const images = Array.isArray(input.images)
    ? input.images.filter((src) => typeof src === 'string' && src.startsWith('/uploads/')).slice(0, 12)
    : existing.images || [];
  return {
    ...existing,
    name: str(input.name, 120) || existing.name || 'Untitled product',
    description: str(input.description, 3000),
    category: str(input.category, 60),
    price: price ?? existing.price ?? 0,
    salePrice: salePrice !== null && price !== null && salePrice < price ? salePrice : null,
    onSale: Boolean(input.onSale),
    soldOut: Boolean(input.soldOut),
    featured: Boolean(input.featured),
    sizes: list(input.sizes),
    colors: list(input.colors),
    images,
    updatedAt: new Date().toISOString(),
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const finalPrice = (p) => (p.onSale && p.salePrice != null && p.salePrice < p.price ? p.salePrice : p.price);

const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'pending', 'paid', 'failed'];

// Checks the customer's details. Returns [customer, error].
function sanitizeCustomer(input = {}) {
  const c = {
    firstName: str(input.firstName, 50),
    lastName: str(input.lastName, 50),
    phone: str(input.phone, 20).replace(/[^\d+]/g, ''),
    email: str(input.email, 120),
    address: str(input.address, 300),
    city: str(input.city, 60),
    notes: str(input.notes, 300),
  };
  if (!c.firstName || !c.lastName) return [null, 'Please enter your first and last name'];
  const digits = c.phone.replace(/\D/g, '').length;
  if (digits < 10 || digits > 15) return [null, 'Please enter a valid contact number'];
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return [null, 'Please enter a valid email or leave it empty'];
  if (c.address.length < 10) return [null, 'Please enter your full address (house, street, area)'];
  if (!c.city) return [null, 'Please enter your city'];
  return [c, null];
}

// Rebuilds the cart from the store's own prices so customers cannot change them. Returns [items, error].
function buildOrderItems(lines) {
  if (!Array.isArray(lines) || !lines.length) return [null, 'Your bag is empty'];
  if (lines.length > 50) return [null, 'Too many items in one order'];
  const items = [];
  for (const line of lines) {
    const product = store.products.find((p) => p.id === line?.id);
    if (!product) return [null, 'An item in your bag is no longer available. Please remove it and try again.'];
    if (product.soldOut) return [null, `"${product.name}" is sold out. Please remove it from your bag.`];
    const qty = Math.floor(Number(line.qty));
    if (!(qty >= 1 && qty <= 20)) return [null, 'Invalid quantity'];
    const size = product.sizes?.length ? str(line.size, 60) : '';
    const color = product.colors?.length ? str(line.color, 60) : '';
    if (size && !product.sizes.includes(size)) return [null, `Please pick a size for "${product.name}" again`];
    if (color && !product.colors.includes(color)) return [null, `Please pick a colour for "${product.name}" again`];
    items.push({ productId: product.id, name: product.name, size, color, qty, price: finalPrice(product), image: product.images?.[0] || '' });
  }
  return [items, null];
}

const PAYMENT_METHODS = { cod: true, safepay: SAFEPAY.enabled, easypaisa: EASYPAISA.enabled };

// What the customer is allowed to see about their own order.
function publicOrder(o) {
  return {
    id: o.id,
    number: o.number,
    createdAt: o.createdAt,
    firstName: o.customer.firstName,
    items: o.items,
    total: o.total,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    status: o.status,
  };
}

function baseUrl(req) {
  return PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}

async function safepayCreateTracker(amount) {
  const res = await fetch(`${SAFEPAY.apiUrl}/order/v1/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client: SAFEPAY.apiKey, amount, currency: 'PKR', environment: SAFEPAY.env }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  const token = json?.data?.token;
  if (!res.ok || !token) throw new Error(`Safepay init failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  return token;
}

function safepayCheckoutUrl(req, order) {
  const base = baseUrl(req);
  const params = new URLSearchParams({
    beacon: order.safepay.tracker,
    cancel_url: `${base}/api/payments/safepay/cancel/${order.id}/${order.accessToken}`,
    env: SAFEPAY.env,
    order_id: String(order.number),
    redirect_url: `${base}/api/payments/safepay/return/${order.id}/${order.accessToken}`,
    source: 'custom',
    webhooks: 'false',
  });
  return `${SAFEPAY.checkoutUrl}?${params}`;
}

// ---------- Easypaisa ----------

// Easypay wants the amount with a decimal point, e.g. "2499.0"
const easypaisaAmount = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

// Expiry in Pakistan time (UTC+5, no daylight saving), format "YYYYMMDD HHmmss"
function easypaisaExpiry(hours = 24) {
  const d = new Date(Date.now() + (5 + hours) * 3600 * 1000).toISOString();
  return `${d.slice(0, 10).replace(/-/g, '')} ${d.slice(11, 19).replace(/:/g, '')}`;
}

// merchantHashedReq: the fields sorted by name as "k=v&k=v", AES-ECB encrypted with the hash key, base64.
function easypaisaHash(fields) {
  const text = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('&');
  const key = Buffer.from(EASYPAISA.hashKey);
  const cipher = crypto.createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}

// A page that immediately posts a form to Easypaisa (their checkout only accepts POST).
function autoPostPage(action, fields) {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeAttr(k)}" value="${escapeAttr(v)}">`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Redirecting to Easypaisa…</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;text-align:center">
<form id="f" method="POST" action="${escapeAttr(action)}">${inputs}<p>Taking you to Easypaisa…</p><button type="submit">Continue</button></form>
<script>document.getElementById('f').submit()</script></body></html>`;
}

function escapeAttr(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Asks Easypaisa whether the order was really paid. Returns the transaction details.
async function easypaisaInquire(orderRef) {
  const res = await fetch(`${EASYPAISA.baseUrl}/easypay-service/rest/v4/inquire-transaction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Credentials: Buffer.from(`${EASYPAISA.username}:${EASYPAISA.password}`).toString('base64'),
    },
    body: JSON.stringify({ orderId: orderRef, storeId: EASYPAISA.storeId, accountNum: EASYPAISA.accountNum }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.responseCode !== '0000') {
    throw new Error(`Easypaisa inquiry failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

// Updates the order from Easypaisa's records. Returns true if it is paid.
async function easypaisaSync(order) {
  const tx = await easypaisaInquire(order.easypaisa.orderRef);
  const paid = String(tx.transactionStatus).toUpperCase() === 'PAID' && Math.abs(Number(tx.transactionAmount) - order.total) < 0.01;
  order.easypaisa.transactionStatus = str(String(tx.transactionStatus || ''), 40);
  if (paid && order.paymentStatus !== 'paid') {
    order.paymentStatus = 'paid';
    order.easypaisa.transactionId = str(String(tx.transactionId || ''), 100);
    order.paidAt = new Date().toISOString();
  }
  save();
  return paid;
}

function removeUpload(src) {
  if (typeof src !== 'string' || !src.startsWith('/uploads/')) return;
  const file = path.join(UPLOAD_DIR, path.basename(src));
  fs.promises.unlink(file).catch(() => {});
}

// ---------- Auth ----------

const sessions = new Map();

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

function requireAdmin(req, res, next) {
  const token = parseCookies(req.headers.cookie).admin_session;
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

// ---------- App ----------

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG, WEBP, GIF or AVIF images are allowed'), ok);
  },
});

// Public API
app.get('/api/store', (req, res) => {
  res.json({ settings: store.settings, products: store.products, payments: { safepay: SAFEPAY.enabled, easypaisa: EASYPAISA.enabled } });
});

// Orders
app.post('/api/orders', async (req, res, next) => {
  try {
    const [customer, customerError] = sanitizeCustomer(req.body.customer);
    if (customerError) return res.status(400).json({ error: customerError });
    const [items, itemsError] = buildOrderItems(req.body.items);
    if (itemsError) return res.status(400).json({ error: itemsError });
    const paymentMethod = Object.hasOwn(PAYMENT_METHODS, req.body.paymentMethod) ? req.body.paymentMethod : 'cod';
    if (!PAYMENT_METHODS[paymentMethod]) {
      return res.status(400).json({ error: 'This payment method is not available right now. Please choose Cash on Delivery.' });
    }

    const order = {
      id: crypto.randomBytes(8).toString('hex'),
      number: store.nextOrderNumber,
      accessToken: crypto.randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString(),
      customer,
      items,
      total: Math.round(items.reduce((n, i) => n + i.price * i.qty, 0) * 100) / 100,
      paymentMethod,
      paymentStatus: paymentMethod === 'cod' ? 'unpaid' : 'pending',
      status: 'new',
    };

    if (paymentMethod === 'safepay') {
      try {
        order.safepay = { tracker: await safepayCreateTracker(order.total) };
      } catch (err) {
        console.error(err);
        return res.status(502).json({ error: 'Could not start online payment. Please try again or choose Cash on Delivery.' });
      }
    }

    if (paymentMethod === 'easypaisa') {
      order.easypaisa = { orderRef: `WAH${order.number}${order.id.slice(0, 6).toUpperCase()}` };
    }

    store.nextOrderNumber += 1;
    store.orders.unshift(order);
    save();
    res.json({
      order: publicOrder(order),
      accessToken: order.accessToken,
      redirect:
        paymentMethod === 'safepay' ? safepayCheckoutUrl(req, order)
        : paymentMethod === 'easypaisa' ? `/api/payments/easypaisa/start/${order.id}/${order.accessToken}`
        : null,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/orders/:id', (req, res) => {
  const order = store.orders.find((o) => o.id === req.params.id);
  if (!order || !safeEqual(order.accessToken, req.query.t)) return res.status(404).json({ error: 'Order not found' });
  res.json(publicOrder(order));
});

function findOrderForPayment(req, method = 'safepay') {
  const order = store.orders.find((o) => o.id === req.params.id);
  return order && order.paymentMethod === method && safeEqual(order.accessToken, req.params.token) ? order : null;
}

// Safepay sends the customer back here after paying. The signature proves the tracker really was paid.
app.all('/api/payments/safepay/return/:id/:token', express.urlencoded({ extended: false }), (req, res) => {
  const order = findOrderForPayment(req);
  if (!order) return res.redirect(303, '/');
  const params = { ...req.query, ...req.body };
  const tracker = str(params.tracker, 200);
  const expectedSig = crypto.createHmac('sha256', SAFEPAY.secretKey).update(tracker).digest('hex');
  const valid = tracker && tracker === order.safepay.tracker && safeEqual(expectedSig, params.sig);
  if (valid && order.paymentStatus !== 'paid') {
    order.paymentStatus = 'paid';
    order.safepay.reference = str(params.reference, 100);
    order.paidAt = new Date().toISOString();
    save();
  } else if (!valid) {
    console.warn(`Safepay return for order #${order.number} had an invalid signature`);
  }
  const query = new URLSearchParams({ order: order.id, t: order.accessToken });
  if (!valid && order.paymentStatus !== 'paid') query.set('payment', 'failed');
  res.redirect(303, `/?${query}`);
});

app.all('/api/payments/safepay/cancel/:id/:token', (req, res) => {
  const order = findOrderForPayment(req);
  if (order && order.paymentStatus === 'pending') {
    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    save();
  }
  res.redirect(303, '/?payment=cancelled');
});

// Admin auth
app.post('/api/admin/login', (req, res) => {
  const password = str(req.body.password, 200);
  if (!password || !verifyPassword(password, store.admin.passwordHash)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + SESSION_TTL_MS });
  res.setHeader(
    'Set-Cookie',
    `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
  );
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  sessions.delete(parseCookies(req.headers.cookie).admin_session);
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true }));

app.post('/api/admin/password', requireAdmin, (req, res) => {
  const current = str(req.body.current, 200);
  const next = str(req.body.next, 200);
  if (!verifyPassword(current, store.admin.passwordHash)) {
    return res.status(400).json({ error: 'Current password is wrong' });
  }
  if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  store.admin.passwordHash = hashPassword(next);
  save();
  res.json({ ok: true });
});

// Images
app.post('/api/admin/upload', requireAdmin, (req, res) => {
  upload.array('images', 12)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ files: (req.files || []).map((f) => `/uploads/${f.filename}`) });
  });
});

// Products
app.post('/api/admin/products', requireAdmin, (req, res) => {
  const product = sanitizeProduct(req.body, {
    id: crypto.randomBytes(8).toString('hex'),
    createdAt: new Date().toISOString(),
  });
  store.products.unshift(product);
  save();
  res.json(product);
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const idx = store.products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Product not found' });
  const old = store.products[idx];
  const updated = sanitizeProduct(req.body, old);
  old.images.filter((src) => !updated.images.includes(src)).forEach(removeUpload);
  store.products[idx] = updated;
  save();
  res.json(updated);
});

app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
  const product = store.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  for (const key of ['onSale', 'soldOut', 'featured']) {
    if (key in req.body) product[key] = Boolean(req.body[key]);
  }
  product.updatedAt = new Date().toISOString();
  save();
  res.json(product);
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const idx = store.products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Product not found' });
  const [removed] = store.products.splice(idx, 1);
  removed.images.forEach(removeUpload);
  save();
  res.json({ ok: true });
});

// Easypaisa step 1: post the order to Easypaisa's checkout page
app.get('/api/payments/easypaisa/start/:id/:token', (req, res) => {
  const order = findOrderForPayment(req, 'easypaisa');
  if (!order || order.paymentStatus !== 'pending') return res.redirect(303, '/');
  const fields = {
    amount: easypaisaAmount(order.total),
    autoRedirect: '1',
    expiryDate: easypaisaExpiry(),
    orderRefNum: order.easypaisa.orderRef,
    postBackURL: `${baseUrl(req)}/api/payments/easypaisa/confirm/${order.id}/${order.accessToken}`,
    storeId: EASYPAISA.storeId,
  };
  if (order.customer.email) fields.emailAddr = order.customer.email;
  const mobile = order.customer.phone.replace(/\D/g, '').replace(/^92/, '0');
  if (/^03\d{9}$/.test(mobile)) fields.mobileNum = mobile;
  fields.merchantHashedReq = easypaisaHash(fields);
  res.type('html').send(autoPostPage(`${EASYPAISA.baseUrl}/easypay/Index.jsf`, fields));
});

// Easypaisa step 2: Easypaisa sends back an auth_token, which must be posted to Confirm.jsf
app.all('/api/payments/easypaisa/confirm/:id/:token', express.urlencoded({ extended: false }), (req, res) => {
  const order = findOrderForPayment(req, 'easypaisa');
  const authToken = str(req.query.auth_token || req.body?.auth_token, 500);
  if (!order || !authToken) return res.redirect(303, '/?payment=cancelled');
  res.type('html').send(
    autoPostPage(`${EASYPAISA.baseUrl}/easypay/Confirm.jsf`, {
      auth_token: authToken,
      postBackURL: `${baseUrl(req)}/api/payments/easypaisa/status/${order.id}/${order.accessToken}`,
    })
  );
});

// Easypaisa step 3: the customer comes back. The status in the URL is not signed,
// so the order is only marked paid after Easypaisa's inquiry API confirms it.
app.all('/api/payments/easypaisa/status/:id/:token', express.urlencoded({ extended: false }), async (req, res) => {
  const order = findOrderForPayment(req, 'easypaisa');
  if (!order) return res.redirect(303, '/');
  const query = new URLSearchParams({ order: order.id, t: order.accessToken });
  if (order.paymentStatus === 'paid') return res.redirect(303, `/?${query}`);
  const reported = str(req.query.status || req.body?.status, 10);
  try {
    if (await easypaisaSync(order)) return res.redirect(303, `/?${query}`);
  } catch (err) {
    console.error(err);
  }
  if (reported && reported !== '0000' && order.paymentStatus === 'pending') {
    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    save();
    return res.redirect(303, '/?payment=cancelled');
  }
  query.set('payment', 'failed');
  res.redirect(303, `/?${query}`);
});

// Admin: orders
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json(store.orders.map(({ accessToken, ...o }) => o));
});

// Re-checks an Easypaisa order with Easypaisa (e.g. the customer closed the page after paying)
app.post('/api/admin/orders/:id/check-payment', requireAdmin, async (req, res) => {
  const order = store.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.paymentMethod !== 'easypaisa' || !EASYPAISA.enabled) {
    return res.status(400).json({ error: 'Only Easypaisa orders can be checked' });
  }
  try {
    await easypaisaSync(order);
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'Could not reach Easypaisa. Please try again.' });
  }
  const { accessToken, ...rest } = order;
  res.json(rest);
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const order = store.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (ORDER_STATUSES.includes(req.body.status)) order.status = req.body.status;
  if (PAYMENT_STATUSES.includes(req.body.paymentStatus)) order.paymentStatus = req.body.paymentStatus;
  order.updatedAt = new Date().toISOString();
  save();
  const { accessToken, ...rest } = order;
  res.json(rest);
});

// Settings
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const body = req.body || {};
  const social = body.social || {};
  store.settings = {
    storeName: str(body.storeName, 60) || store.settings.storeName,
    tagline: str(body.tagline, 160),
    currency: str(body.currency, 8) || 'Rs.',
    announcement: str(body.announcement, 200),
    heroTitle: str(body.heroTitle, 120),
    heroSubtitle: str(body.heroSubtitle, 300),
    categories: list(body.categories),
    social: {
      facebook: safeUrl(social.facebook),
      instagram: safeUrl(social.instagram),
      tiktok: safeUrl(social.tiktok),
      youtube: safeUrl(social.youtube),
      whatsapp: str(social.whatsapp, 20).replace(/[^\d]/g, ''),
      phone: str(social.phone, 20).replace(/[^\d+]/g, ''),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(social.email, 120)) ? str(social.email, 120) : '',
    },
  };
  save();
  res.json(store.settings);
});

// Static files
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`Store running:      http://localhost:${PORT}`);
  console.log(`Admin dashboard:    http://localhost:${PORT}/admin`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log('Default admin password is "admin123" - change it from Dashboard > Settings.');
  }
  console.log(SAFEPAY.enabled ? `Safepay online payments: ON (${SAFEPAY.env})` : 'Safepay online payments: OFF (set SAFEPAY_API_KEY and SAFEPAY_SECRET_KEY)');
  console.log(
    EASYPAISA.enabled
      ? `Easypaisa payments: ON (${EASYPAISA.env})`
      : 'Easypaisa payments: OFF (set EASYPAISA_STORE_ID, EASYPAISA_HASH_KEY, EASYPAISA_USERNAME, EASYPAISA_PASSWORD, EASYPAISA_ACCOUNT_NUM)'
  );
});
