const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const storage = require('./lib/storage');
const { withContentDefaults, sanitizeContent, contentImages } = require('./lib/content');
const notify = require('./lib/notify');
const SEED = require('./data/seed.json');

const PORT = process.env.PORT || 3000;
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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

let freshStore = false; // true on the very first start, when the store is created from seed.json

// The store is loaded at the start of every API request (see the /api middleware below),
// so every running copy of the server sees the latest data.
let store = null;
let dirty = false;

async function loadStore() {
  const data = await storage.loadData();
  if (!data) {
    freshStore = true;
    const seed = withDefaults(structuredClone(SEED));
    seed.admin = { passwordHash: hashPassword(DEFAULT_PASSWORD), mustChangePassword: true };
    await storage.saveData(seed);
    return seed;
  }
  if (!data.secret) dirty = true; // withDefaults creates it, keep it
  return withDefaults(data);
}

// Fills in anything an older store.json does not have yet.
function withDefaults(data) {
  data.orders ||= [];
  data.nextOrderNumber ||= 1001;
  data.users ||= [];
  data.secret ||= crypto.randomBytes(32).toString('hex'); // signs customer login cookies
  data.accountSettings = { allowRegistration: true, requireLogin: false, ...data.accountSettings };
  data.paymentSettings = { cod: true, manualAccounts: [], ...data.paymentSettings };
  data.content = withContentDefaults(data.content);
  data.applications ||= []; // "Earn with us" form
  // WhatsApp alerts to the owner (CallMeBot)
  data.notifySettings = { phone: '', apiKey: '', onOrder: true, onEarn: true, ...data.notifySettings };
  data.deliverySettings = { fee: 0, freeAbove: 0, cityFees: [], ...data.deliverySettings };
  data.collections ||= []; // e.g. "Eid Collection", shown as rows on the home page
  data.reviews ||= []; // customer reviews, shown after the admin approves them
  data.staff ||= []; // staff logins with limited permissions
  // Admins from before the strong-password rule must pick a strong password once
  if (data.admin && data.admin.passwordPolicy !== 2) data.admin.mustChangePassword = true;
  return data;
}

// Changes are written once, just before the response is sent.
function save() {
  dirty = true;
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
    ? input.images.filter(storage.isUploadUrl).slice(0, 12)
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
    colors: list(input.colors, 60),
    images,
    updatedAt: new Date().toISOString(),
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Last 10 digits, so 03001234567, +923001234567 and 923001234567 all match.
const phoneKey = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

// ---------- Manual payment accounts (bank / Easypaisa / JazzCash) ----------

const MANUAL_TYPES = { bank: 'Bank transfer', easypaisa: 'Easypaisa', jazzcash: 'JazzCash', other: 'Other' };

function sanitizeManualAccount(input = {}) {
  return {
    id: /^[a-f0-9]{12}$/.test(input.id) ? input.id : crypto.randomBytes(6).toString('hex'),
    type: Object.hasOwn(MANUAL_TYPES, input.type) ? input.type : 'bank',
    name: str(input.name, 80),
    accountTitle: str(input.accountTitle, 80),
    accountNumber: str(input.accountNumber, 40),
    iban: str(input.iban, 40).toUpperCase().replace(/\s+/g, ''),
    instructions: str(input.instructions, 400),
    enabled: input.enabled !== false,
  };
}

const activeManualAccounts = () =>
  store.paymentSettings.manualAccounts.filter((a) => a.enabled && a.accountTitle && (a.accountNumber || a.iban));

// ---------- Customer accounts ----------

function publicUser(u) {
  const { passwordHash, tokenVersion, ...rest } = u;
  return rest;
}

// Checks name/email/phone/address fields for a customer profile. Returns [fields, error].
function sanitizeProfile(input = {}, userId = null) {
  const p = {
    firstName: str(input.firstName, 50),
    lastName: str(input.lastName, 50),
    email: str(input.email, 120).toLowerCase(),
    phone: str(input.phone, 20).replace(/[^\d+]/g, ''),
    address: str(input.address, 300),
    city: str(input.city, 60),
  };
  if (!p.firstName || !p.lastName) return [null, 'Please enter your first and last name'];
  if (!EMAIL_RE.test(p.email)) return [null, 'Please enter a valid email'];
  const digits = p.phone.replace(/\D/g, '').length;
  if (digits < 10 || digits > 15) return [null, 'Please enter a valid mobile number'];
  const others = store.users.filter((u) => u.id !== userId);
  if (others.some((u) => u.email === p.email)) return [null, 'An account with this email already exists'];
  if (others.some((u) => phoneKey(u.phone) === phoneKey(p.phone))) return [null, 'An account with this mobile number already exists'];
  return [p, null];
}

// Login cookie: "userId.expiry.version.signature". Changing tokenVersion logs the customer out everywhere.
function userToken(user) {
  const payload = `${user.id}.${Date.now() + USER_SESSION_TTL_MS}.${user.tokenVersion}`;
  const sig = crypto.createHmac('sha256', store.secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).user_session || '';
  const [id, exp, version, sig] = token.split('.');
  if (!sig) return null;
  const expected = crypto.createHmac('sha256', store.secret).update(`${id}.${exp}.${version}`).digest('base64url');
  if (!safeEqual(expected, sig) || Number(exp) < Date.now()) return null;
  const user = store.users.find((u) => u.id === id);
  return user && !user.blocked && String(user.tokenVersion) === version ? user : null;
}

const secureFlag = () => (PUBLIC_URL.startsWith('https://') ? '; Secure' : '');

function setUserCookie(res, user) {
  res.setHeader(
    'Set-Cookie',
    `user_session=${userToken(user)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${USER_SESSION_TTL_MS / 1000}${secureFlag()}`
  );
}

function clearUserCookie(res) {
  res.setHeader('Set-Cookie', `user_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag()}`);
}

function requireUser(req, res, next) {
  req.user = currentUser(req);
  if (!req.user) return res.status(401).json({ error: 'Please log in' });
  next();
}

// Slows down password guessing: 8 wrong tries per 15 minutes per IP + login name.
const failedLogins = new Map();
function loginBlocked(key) {
  const entry = failedLogins.get(key);
  if (entry && entry.until < Date.now()) failedLogins.delete(key);
  return (failedLogins.get(key)?.count || 0) >= 8;
}
function loginFailed(key) {
  const entry = failedLogins.get(key) || { count: 0, until: Date.now() + 15 * 60 * 1000 };
  entry.count += 1;
  failedLogins.set(key, entry);
}

const finalPrice = (p) => (p.onSale && p.salePrice != null && p.salePrice < p.price ? p.salePrice : p.price);

// The customer sees each step with its date (statusHistory).
const ORDER_STATUSES = ['new', 'confirmed', 'packing', 'ready', 'picked', 'shipped', 'delivered', 'returned', 'rejected', 'cancelled'];

function setOrderStatus(order, status) {
  if (order.status === status) return;
  order.status = status;
  order.statusHistory = [...(order.statusHistory || []), { status, at: new Date().toISOString() }];
}
// Orders in these states do not count towards sales
const LOST_STATUSES = ['cancelled', 'returned', 'rejected'];
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
  if (c.email && !EMAIL_RE.test(c.email)) return [null, 'Please enter a valid email or leave it empty'];
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

// Delivery charge: free above a set amount, else the city's own charge, else the normal charge.
function deliveryFeeFor(city, subtotal) {
  const d = store.deliverySettings;
  if (d.freeAbove > 0 && subtotal >= d.freeAbove) return 0;
  const match = d.cityFees.find((c) => c.city.toLowerCase() === String(city || '').trim().toLowerCase());
  return match ? match.fee : d.fee;
}

const paymentMethods = () => ({
  cod: store.paymentSettings.cod,
  manual: activeManualAccounts().length > 0,
  safepay: SAFEPAY.enabled,
  easypaisa: EASYPAISA.enabled,
});

// What the customer is allowed to see about their own order.
function publicOrder(o) {
  return {
    id: o.id,
    number: o.number,
    createdAt: o.createdAt,
    firstName: o.customer.firstName,
    items: o.items,
    subtotal: o.subtotal ?? o.total,
    deliveryFee: o.deliveryFee || 0,
    total: o.total,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    manualPayment: o.manualPayment
      ? { typeLabel: MANUAL_TYPES[o.manualPayment.type], name: o.manualPayment.name, reference: o.manualPayment.reference, hasReceipt: Boolean(o.manualPayment.receipt) }
      : undefined,
    status: o.status,
    statusHistory: o.statusHistory || [{ status: 'new', at: o.createdAt }],
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

// Home page slider: up to 6 pictures, each with an optional heading and line of text.
function sanitizeSlides(input) {
  return (Array.isArray(input) ? input : [])
    .filter((s) => storage.isUploadUrl(s?.image))
    .slice(0, 6)
    .map((s) => ({ image: s.image, title: str(s.title, 80), subtitle: str(s.subtitle, 160) }));
}

function isImageInUse(src) {
  return (
    store.products.some((p) => p.images?.includes(src)) ||
    (store.settings.slides || []).some((s) => s.image === src) ||
    contentImages(store.content).includes(src)
  );
}

function removeUpload(src) {
  storage.removeImage(src);
}

// ---------- Admin security: strong password + Google Authenticator ----------

// Returns what is missing from a password ([] means it is strong enough).
function passwordProblems(pw) {
  const missing = [];
  if (pw.length < 10) missing.push('at least 10 characters');
  if (!/[a-z]/.test(pw)) missing.push('a small letter');
  if (!/[A-Z]/.test(pw)) missing.push('a capital letter');
  if (!/[0-9]/.test(pw)) missing.push('a number');
  if (!/[^A-Za-z0-9]/.test(pw)) missing.push('a symbol like ! @ # $');
  if (/admin|password|qwerty|12345|abcde|wah/i.test(pw)) missing.push('no easy words like "admin", "password" or "12345"');
  return missing;
}

// TOTP (RFC 6238), the codes Google Authenticator shows: HMAC-SHA1, 30 seconds, 6 digits.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of text.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = ((value << 5) | B32.indexOf(ch)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpCode(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hash = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, '0');
}

// Accepts the current code or the one just before/after (phone clocks drift).
// Returns the time step used, so the same code cannot be used twice.
function checkTotp(secret, code, lastCounter = -1) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = Math.floor(Date.now() / 30000);
  for (const counter of [now - 1, now, now + 1]) {
    if (counter > lastCounter && safeEqual(totpCode(secret, counter), clean)) return counter;
  }
  return null;
}

const WRONG_CODE = 'Wrong or already used code. Wait for the next code in Google Authenticator and try again.';

const hashRecoveryCode = (code) => crypto.createHash('sha256').update(code.toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

function newRecoveryCodes() {
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').replace(/(.{5})/, '$1-'));
  store.admin.recoveryCodes = codes.map(hashRecoveryCode);
  return codes;
}

// Checks a Google Authenticator code, or uses up one recovery code. Saves when it succeeds.
function checkSecondFactor(code) {
  const totp = store.admin.totp;
  if (!totp) return true;
  const counter = checkTotp(totp.secret, code, totp.lastCounter);
  if (counter !== null) {
    totp.lastCounter = counter;
    save();
    return true;
  }
  const hash = hashRecoveryCode(String(code || ''));
  const idx = (store.admin.recoveryCodes || []).findIndex((h) => safeEqual(h, hash));
  if (idx === -1 || String(code || '').replace(/[^a-z0-9]/gi, '').length !== 10) return false;
  store.admin.recoveryCodes.splice(idx, 1);
  save();
  return true;
}

// ---------- Auth ----------

// Admin login cookie: "admin.expiry.version.signature". It is signed instead of kept in memory,
// so it works on every copy of the server. Raising sessionVersion logs out every device.
const sign = (payload) => crypto.createHmac('sha256', store.secret).update(payload).digest('base64url');
const adminSessionVersion = () => String(store.admin.sessionVersion || 1);

// Staff cookies are "staff.<id>.expiry.version.signature"; the version is the staff member's own,
// so changing their password or switching them off logs them out.
function startAdminSession(res, staff = null) {
  const payload = staff
    ? `staff.${staff.id}.${Date.now() + SESSION_TTL_MS}.${staff.tokenVersion}`
    : `admin.${Date.now() + SESSION_TTL_MS}.${adminSessionVersion()}`;
  res.setHeader(
    'Set-Cookie',
    `admin_session=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secureFlag()}`
  );
}

// Who is logged in to the dashboard: { role: 'owner' } or { role: 'staff', staff }, or null.
function adminIdentity(req) {
  const parts = (parseCookies(req.headers.cookie).admin_session || '').split('.');
  const sig = parts.pop();
  if (!sig || !safeEqual(sign(parts.join('.')), sig)) return null;
  if (parts[0] === 'admin' && parts.length === 3) {
    const [, exp, version] = parts;
    return Number(exp) > Date.now() && version === adminSessionVersion() ? { role: 'owner' } : null;
  }
  if (parts[0] === 'staff' && parts.length === 4) {
    const [, id, exp, version] = parts;
    const staff = store.staff.find((m) => m.id === id);
    return staff && staff.active && Number(exp) > Date.now() && String(staff.tokenVersion) === version ? { role: 'staff', staff } : null;
  }
  return null;
}

// What staff can be allowed to do. The owner can do everything, and alone manages staff,
// security, WhatsApp alerts and backups.
const STAFF_PERMISSIONS = {
  orders: 'Orders (see, change status, print slips)',
  products: 'Products & collections (add, edit, prices)',
  customers: 'Customers',
  payments: 'Payments & delivery charges',
  content: 'Store settings, pages & popup',
  reviews: 'Reviews',
  earn: 'Earn with us forms',
};

// Password was right, waiting for the Google Authenticator code (5 minutes).
// Tied to the password, so it stops working if the password changes.
function loginTicket() {
  const exp = Date.now() + 5 * 60 * 1000;
  return `${exp}.${sign(`ticket.${exp}.${store.admin.passwordHash}`)}`;
}

function validLoginTicket(ticket) {
  const [exp, sig] = String(ticket || '').split('.');
  return Boolean(sig) && Number(exp) > Date.now() && safeEqual(sign(`ticket.${exp}.${store.admin.passwordHash}`), sig);
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

// Logged in (enough to set a new password)
function requireAdminSession(req, res, next) {
  req.admin = adminIdentity(req);
  if (!req.admin) return res.status(401).json({ error: 'Not logged in' });
  next();
}

// The owner, logged in with a strong password
function requireAdmin(req, res, next) {
  requireAdminSession(req, res, () => {
    if (req.admin.role !== 'owner') return res.status(403).json({ error: 'Only the store owner can do this' });
    if (store.admin.mustChangePassword) {
      return res.status(403).json({ error: 'Please set a new strong password first', mustChangePassword: true });
    }
    next();
  });
}

// The owner, or staff with one of these permissions
const allow = (...perms) => (req, res, next) =>
  requireAdminSession(req, res, () => {
    if (req.admin.role === 'owner') return requireAdmin(req, res, next);
    if (!perms.some((p) => req.admin.staff.permissions.includes(p))) {
      return res.status(403).json({ error: 'You do not have permission for this' });
    }
    next();
  });

// ---------- App ----------

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// The saved file's extension comes from the checked image type, never from the uploaded name,
// so nothing but images can ever be served from these folders.
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };

// Files are held in memory, then saved by lib/storage.js (a folder, or Vercel Blob).
// The dashboard and checkout shrink pictures first, because Vercel accepts at most 4.5MB per request.
function imageUploader(limits) {
  return multer({
    storage: multer.memoryStorage(),
    limits,
    fileFilter: (req, file, cb) => {
      const ok = Object.hasOwn(IMAGE_EXT, file.mimetype);
      cb(ok ? null : new Error('Only JPG, PNG, WEBP, GIF or AVIF images are allowed'), ok);
    },
  });
}

const upload = imageUploader({ fileSize: 8 * 1024 * 1024, files: 12 });
const receiptUpload = imageUploader({ fileSize: 5 * 1024 * 1024, files: 1 });

// ---------- Loading and saving the store around every API request ----------

// Requests are handled one at a time on each copy of the server, and requests that may
// change something also hold a lock shared by all copies (on Vercel), so no change is lost.
let queue = Promise.resolve();

app.use('/api', (req, res, next) => {
  const missing = storage.cloud ? storage.missingSetup() : [];
  if (missing.length) {
    return res.status(503).json({ error: `Store setup is not finished. Connect in Vercel > Storage: ${missing.join(', ')}` });
  }
  const readOnly = req.method === 'GET' && ['/store', '/admin/backup'].includes(req.path);
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  const turn = queue;
  queue = queue.then(() => done);

  turn.then(async () => {
    let unlock = async () => {};
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      Promise.resolve(unlock()).finally(finish);
    };
    const timer = setTimeout(release, 60000); // never block the queue forever

    try {
      if (!readOnly) unlock = await storage.lock();
      dirty = false;
      store = await loadStore();
    } catch (err) {
      console.error(err);
      release();
      return res.status(503).json({ error: 'The store could not load its data. Please try again.' });
    }

    // Write the changes before the answer goes out, so they are never lost.
    const end = res.end;
    let ending = false;
    res.end = function (...args) {
      if (ending) return this;
      ending = true;
      const changes = dirty && !readOnly ? store : null;
      dirty = false;
      Promise.resolve(changes && storage.saveData(changes))
        .catch((err) => {
          console.error(err);
          if (!res.headersSent) {
            const body = JSON.stringify({ error: 'Your change could not be saved. Please try again.' });
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Length', Buffer.byteLength(body));
            args = [body];
          }
        })
        .then(() => {
          end.apply(res, args);
          release();
        });
      return this;
    };
    next();
  });
});

// Public API
app.get('/api/store', (req, res) => {
  res.json({
    settings: store.settings,
    products: store.products,
    payments: { ...paymentMethods(), manualAccounts: activeManualAccounts() },
    accounts: store.accountSettings,
    content: store.content,
    delivery: store.deliverySettings,
    collections: store.collections,
    reviews: store.reviews.filter((r) => r.status === 'approved').map(publicReview),
  });
});

// ---------- Reviews ----------

const publicReview = ({ id, productId, name, rating, text, verified, createdAt }) => ({ id, productId, name, rating, text, verified, createdAt });

const recentReviews = new Map(); // ip -> times, max 5 per hour
app.post('/api/reviews', (req, res) => {
  const now = Date.now();
  const times = (recentReviews.get(req.ip) || []).filter((t) => t > now - 3600 * 1000);
  if (times.length >= 5) return res.status(429).json({ error: 'Too many reviews. Please try again later.' });
  const product = store.products.find((p) => p.id === req.body.productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const rating = Math.round(Number(req.body.rating));
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'Please choose 1 to 5 stars' });
  const name = str(req.body.name, 60);
  const text = str(req.body.text, 1000);
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name' });
  if (text.length < 3) return res.status(400).json({ error: 'Please write a few words about the product' });
  recentReviews.set(req.ip, [...times, now]);
  const user = currentUser(req);
  // "Verified buyer" when a logged-in customer has an order with this product
  const verified = Boolean(user && store.orders.some((o) => o.userId === user.id && !LOST_STATUSES.includes(o.status) && o.items.some((i) => i.productId === product.id)));
  store.reviews.unshift({
    id: crypto.randomBytes(8).toString('hex'),
    productId: product.id,
    productName: product.name,
    name,
    rating,
    text,
    verified,
    userId: user?.id,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  store.reviews.length = Math.min(store.reviews.length, 5000);
  save();
  res.json({ ok: true });
});

// ---------- Customer accounts ----------

app.post('/api/account/register', (req, res) => {
  if (!store.accountSettings.allowRegistration) return res.status(403).json({ error: 'New registrations are closed right now' });
  const [profile, error] = sanitizeProfile(req.body);
  if (error) return res.status(400).json({ error });
  const password = str(req.body.password, 200);
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const user = {
    id: crypto.randomBytes(8).toString('hex'),
    ...profile,
    passwordHash: hashPassword(password),
    tokenVersion: 1,
    blocked: false,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  store.users.unshift(user);
  save();
  setUserCookie(res, user);
  res.json(publicUser(user));
});

app.post('/api/account/login', (req, res) => {
  const login = str(req.body.login, 120).toLowerCase();
  const password = str(req.body.password, 200);
  const key = `user:${req.ip}:${login}`;
  if (loginBlocked(key)) return res.status(429).json({ error: 'Too many wrong tries. Please wait 15 minutes.' });
  const user = login && store.users.find((u) => u.email === login || (phoneKey(login).length === 10 && phoneKey(u.phone) === phoneKey(login)));
  if (!user || !password || !verifyPassword(password, user.passwordHash)) {
    loginFailed(key);
    return res.status(401).json({ error: 'Wrong email/mobile number or password' });
  }
  if (user.blocked) return res.status(403).json({ error: 'Your account has been blocked. Please contact us.' });
  failedLogins.delete(key);
  user.lastLoginAt = new Date().toISOString();
  save();
  setUserCookie(res, user);
  res.json(publicUser(user));
});

app.post('/api/account/logout', (req, res) => {
  clearUserCookie(res);
  res.json({ ok: true });
});

app.get('/api/account', requireUser, (req, res) => {
  const orders = store.orders.filter((o) => o.userId === req.user.id).map(publicOrder);
  res.json({ user: publicUser(req.user), orders });
});

app.put('/api/account', requireUser, (req, res) => {
  const [profile, error] = sanitizeProfile(req.body, req.user.id);
  if (error) return res.status(400).json({ error });
  Object.assign(req.user, profile, { updatedAt: new Date().toISOString() });
  save();
  res.json(publicUser(req.user));
});

app.post('/api/account/password', requireUser, (req, res) => {
  if (!verifyPassword(str(req.body.current, 200), req.user.passwordHash)) {
    return res.status(400).json({ error: 'Current password is wrong' });
  }
  const next = str(req.body.next, 200);
  if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  req.user.passwordHash = hashPassword(next);
  req.user.tokenVersion += 1; // logs out other devices
  save();
  setUserCookie(res, req.user);
  res.json({ ok: true });
});

// Orders
app.post('/api/orders', async (req, res, next) => {
  try {
    const user = currentUser(req);
    if (store.accountSettings.requireLogin && !user) {
      return res.status(401).json({ error: 'Please log in or create an account to place your order' });
    }
    const [customer, customerError] = sanitizeCustomer(req.body.customer);
    if (customerError) return res.status(400).json({ error: customerError });
    const [items, itemsError] = buildOrderItems(req.body.items);
    if (itemsError) return res.status(400).json({ error: itemsError });
    const methods = paymentMethods();
    const paymentMethod = str(req.body.paymentMethod, 20);
    if (!methods[paymentMethod]) {
      return res.status(400).json({ error: 'This payment method is not available right now. Please choose another one.' });
    }
    let manualPayment;
    if (paymentMethod === 'manual') {
      const account = activeManualAccounts().find((a) => a.id === req.body.manual?.accountId);
      if (!account) return res.status(400).json({ error: 'Please choose the account you paid to' });
      const reference = str(req.body.manual?.reference, 60);
      if (reference.length < 4) return res.status(400).json({ error: 'Please enter the transaction ID (TID) of your payment' });
      const { id, type, name, accountTitle, accountNumber, iban } = account;
      manualPayment = { accountId: id, type, name, accountTitle, accountNumber, iban, reference, receipt: null };
    }

    const subtotal = Math.round(items.reduce((n, i) => n + i.price * i.qty, 0) * 100) / 100;
    const deliveryFee = deliveryFeeFor(customer.city, subtotal);
    const order = {
      id: crypto.randomBytes(8).toString('hex'),
      number: store.nextOrderNumber,
      accessToken: crypto.randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString(),
      customer,
      items,
      subtotal,
      deliveryFee,
      total: Math.round((subtotal + deliveryFee) * 100) / 100,
      paymentMethod,
      paymentStatus: paymentMethod === 'cod' ? 'unpaid' : 'pending',
      status: 'new',
      statusHistory: [{ status: 'new', at: new Date().toISOString() }],
    };
    if (manualPayment) order.manualPayment = manualPayment;
    if (user) {
      order.userId = user.id;
      // Remember the delivery address on the customer's profile the first time
      if (!user.address) Object.assign(user, { address: customer.address, city: customer.city });
    }

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
    if (store.notifySettings.onOrder) await alertOwner(notify.orderMessage(order, store.settings.currency));
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

// Payment screenshot for a bank / Easypaisa / JazzCash transfer (one per order)
app.post('/api/orders/:id/receipt', (req, res) => {
  const order = store.orders.find((o) => o.id === req.params.id);
  if (!order || !safeEqual(order.accessToken, req.query.t) || order.paymentMethod !== 'manual') {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (order.manualPayment.receipt) return res.status(400).json({ error: 'A screenshot was already sent for this order' });
  receiptUpload.single('receipt')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Please choose a screenshot' });
    try {
      const { file, url } = await storage.saveReceipt(req.file.buffer, IMAGE_EXT[req.file.mimetype], req.file.mimetype);
      order.manualPayment.receipt = file;
      if (url) order.manualPayment.receiptUrl = url;
      save();
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Could not save the screenshot. Please try again.' });
    }
  });
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
    setOrderStatus(order, 'cancelled');
    save();
  }
  res.redirect(303, '/?payment=cancelled');
});

// Admin auth
app.post('/api/admin/login', (req, res) => {
  const password = str(req.body.password, 200);
  const username = str(req.body.username, 60).toLowerCase();
  const key = `admin:${req.ip}`;
  if (loginBlocked(key)) return res.status(429).json({ error: 'Too many wrong tries. Please wait 15 minutes.' });
  if (username) {
    const staff = store.staff.find((m) => m.username === username && m.active);
    if (!staff || !password || !verifyPassword(password, staff.passwordHash)) {
      loginFailed(key);
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    failedLogins.delete(key);
    staff.lastLoginAt = new Date().toISOString();
    save();
    startAdminSession(res, staff);
    return res.json({ ok: true, mustChangePassword: false });
  }
  if (!password || !verifyPassword(password, store.admin.passwordHash)) {
    loginFailed(key);
    return res.status(401).json({ error: 'Wrong password' });
  }
  if (store.admin.totp) return res.json({ twoFactor: true, ticket: loginTicket() });
  failedLogins.delete(key);
  startAdminSession(res);
  res.json({ ok: true, mustChangePassword: Boolean(store.admin.mustChangePassword) });
});

// Step 2 when Google Authenticator is on
app.post('/api/admin/login/code', (req, res) => {
  const key = `admin:${req.ip}`;
  if (loginBlocked(key)) return res.status(429).json({ error: 'Too many wrong tries. Please wait 15 minutes.' });
  if (!validLoginTicket(str(req.body.ticket, 200))) {
    return res.status(401).json({ error: 'Login timed out. Please enter your password again.', restart: true });
  }
  if (!checkSecondFactor(str(req.body.code, 20))) {
    loginFailed(key);
    return res.status(401).json({ error: WRONG_CODE });
  }
  failedLogins.delete(key);
  startAdminSession(res);
  res.json({ ok: true, mustChangePassword: Boolean(store.admin.mustChangePassword) });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdminSession, (req, res) => {
  if (req.admin.role === 'staff') {
    const { name, username, permissions } = req.admin.staff;
    return res.json({ role: 'staff', name, username, permissions, mustChangePassword: false });
  }
  res.json({
    role: 'owner',
    permissions: Object.keys(STAFF_PERMISSIONS),
    mustChangePassword: Boolean(store.admin.mustChangePassword),
    twoFactor: Boolean(store.admin.totp),
    recoveryCodesLeft: (store.admin.recoveryCodes || []).length,
  });
});

app.post('/api/admin/password', requireAdminSession, (req, res) => {
  if (req.admin.role !== 'owner') return res.status(403).json({ error: 'Ask the store owner to change your password' });
  const current = str(req.body.current, 200);
  const next = str(req.body.next, 200);
  if (!verifyPassword(current, store.admin.passwordHash)) {
    return res.status(400).json({ error: 'Current password is wrong' });
  }
  const missing = passwordProblems(next);
  if (missing.length) return res.status(400).json({ error: `New password needs ${missing.join(', ')}` });
  if (next === current) return res.status(400).json({ error: 'Please choose a different password from the current one' });
  store.admin.passwordHash = hashPassword(next);
  store.admin.mustChangePassword = false;
  store.admin.passwordPolicy = 2;
  store.admin.passwordChangedAt = new Date().toISOString();
  // Log out every other device, and keep this one logged in
  store.admin.sessionVersion = Number(adminSessionVersion()) + 1;
  startAdminSession(res);
  save();
  res.json({ ok: true });
});

// Google Authenticator: step 1 — make a secret and show it as a QR code
app.post('/api/admin/2fa/setup', requireAdmin, async (req, res, next) => {
  try {
    if (!verifyPassword(str(req.body.password, 200), store.admin.passwordHash)) {
      return res.status(400).json({ error: 'Password is wrong' });
    }
    const secret = base32Encode(crypto.randomBytes(20));
    store.admin.pendingTotp = { secret, expires: Date.now() + 10 * 60 * 1000 };
    save();
    const issuer = store.settings.storeName || 'Store';
    const label = encodeURIComponent(`${issuer}:admin`);
    const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    res.json({ secret: secret.replace(/(.{4})/g, '$1 ').trim(), qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
  } catch (err) {
    next(err);
  }
});

// Step 2 — the first code from the app switches it on and gives the recovery codes (shown once)
app.post('/api/admin/2fa/enable', requireAdmin, (req, res) => {
  const pendingTotp = store.admin.pendingTotp;
  if (!pendingTotp || pendingTotp.expires < Date.now()) {
    return res.status(400).json({ error: 'Setup timed out. Please start again.' });
  }
  const counter = checkTotp(pendingTotp.secret, str(req.body.code, 20));
  if (counter === null) return res.status(400).json({ error: WRONG_CODE });
  store.admin.totp = { secret: pendingTotp.secret, lastCounter: counter, enabledAt: new Date().toISOString() };
  delete store.admin.pendingTotp;
  const recoveryCodes = newRecoveryCodes();
  save();
  res.json({ recoveryCodes });
});

app.post('/api/admin/2fa/disable', requireAdmin, (req, res) => {
  if (!verifyPassword(str(req.body.password, 200), store.admin.passwordHash)) {
    return res.status(400).json({ error: 'Password is wrong' });
  }
  if (!checkSecondFactor(str(req.body.code, 20))) return res.status(400).json({ error: WRONG_CODE });
  store.admin.totp = null;
  store.admin.recoveryCodes = [];
  save();
  res.json({ ok: true });
});

// Images
app.post('/api/admin/upload', allow('products', 'content'), (req, res) => {
  upload.array('images', 12)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const files = [];
      for (const f of req.files || []) files.push(await storage.saveImage(f.buffer, IMAGE_EXT[f.mimetype], f.mimetype));
      res.json({ files });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Could not save the pictures. Please try again.' });
    }
  });
});

// Admin: product order on the store (drag in the Products tab)
app.put('/api/admin/products/order', allow('products'), (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const rank = new Map(ids.map((id, i) => [id, i]));
  store.products.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  save();
  res.json(store.products.map((p) => p.id));
});

// Products
app.post('/api/admin/products', allow('products'), (req, res) => {
  const product = sanitizeProduct(req.body, {
    id: crypto.randomBytes(8).toString('hex'),
    createdAt: new Date().toISOString(),
  });
  store.products.unshift(product);
  save();
  res.json(product);
});

app.put('/api/admin/products/:id', allow('products'), (req, res) => {
  const idx = store.products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Product not found' });
  const old = store.products[idx];
  const updated = sanitizeProduct(req.body, old);
  old.images.filter((src) => !updated.images.includes(src)).forEach(removeUpload);
  store.products[idx] = updated;
  save();
  res.json(updated);
});

app.patch('/api/admin/products/:id', allow('products'), (req, res) => {
  const product = store.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  for (const key of ['onSale', 'soldOut', 'featured']) {
    if (key in req.body) product[key] = Boolean(req.body[key]);
  }
  product.updatedAt = new Date().toISOString();
  save();
  res.json(product);
});

app.delete('/api/admin/products/:id', allow('products'), (req, res) => {
  const idx = store.products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Product not found' });
  const [removed] = store.products.splice(idx, 1);
  store.collections.forEach((c) => (c.productIds = c.productIds.filter((id) => id !== removed.id)));
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
    setOrderStatus(order, 'cancelled');
    save();
    return res.redirect(303, '/?payment=cancelled');
  }
  query.set('payment', 'failed');
  res.redirect(303, `/?${query}`);
});

// Admin: orders
app.get('/api/admin/orders', allow('orders'), (req, res) => {
  res.json(store.orders.map(({ accessToken, ...o }) => o));
});

// Re-checks an Easypaisa order with Easypaisa (e.g. the customer closed the page after paying)
app.post('/api/admin/orders/:id/check-payment', allow('orders'), async (req, res) => {
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

app.patch('/api/admin/orders/:id', allow('orders'), (req, res) => {
  const order = store.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (ORDER_STATUSES.includes(req.body.status)) setOrderStatus(order, req.body.status);
  if (PAYMENT_STATUSES.includes(req.body.paymentStatus)) order.paymentStatus = req.body.paymentStatus;
  order.updatedAt = new Date().toISOString();
  save();
  const { accessToken, ...rest } = order;
  res.json(rest);
});

app.get('/api/admin/receipts/:file', allow('orders'), async (req, res, next) => {
  const file = path.basename(req.params.file);
  const order = store.orders.find((o) => o.manualPayment?.receipt === file);
  if (!order) return res.status(404).end();
  if (!order.manualPayment.receiptUrl) return res.sendFile(storage.receiptPath(file));
  try {
    const blob = await fetch(order.manualPayment.receiptUrl, { signal: AbortSignal.timeout(15000) });
    if (!blob.ok) return res.status(404).end();
    res.type(blob.headers.get('content-type') || 'image/jpeg').send(Buffer.from(await blob.arrayBuffer()));
  } catch (err) {
    next(err);
  }
});

// Order tracking for customers without an account: order number + the phone used on the order
app.post('/api/orders/track', (req, res) => {
  const number = Number(String(req.body.number || '').replace(/\D/g, ''));
  const phone = str(req.body.phone, 20);
  const key = `track:${req.ip}`;
  if (loginBlocked(key)) return res.status(429).json({ error: 'Too many tries. Please wait 15 minutes.' });
  const order = store.orders.find((o) => o.number === number);
  if (!order || phoneKey(phone).length < 10 || phoneKey(order.customer.phone) !== phoneKey(phone)) {
    loginFailed(key);
    return res.status(404).json({ error: 'No order found with this order number and mobile number' });
  }
  res.json(publicOrder(order));
});

// "Earn with us" form. The customer also sends it to the owner's WhatsApp from the page.
const recentApplications = new Map(); // ip -> times, max 5 per hour
app.post('/api/earn', async (req, res) => {
  const now = Date.now();
  const times = (recentApplications.get(req.ip) || []).filter((t) => t > now - 3600 * 1000);
  if (times.length >= 5) return res.status(429).json({ error: 'Too many forms sent. Please try again later.' });
  const a = {
    name: str(req.body.name, 80),
    city: str(req.body.city, 60),
    email: str(req.body.email, 120).toLowerCase(),
    phone: str(req.body.phone, 20).replace(/[^\d+]/g, ''),
    message: str(req.body.message, 500),
  };
  if (a.name.length < 2) return res.status(400).json({ error: 'Please enter your name' });
  if (!a.city) return res.status(400).json({ error: 'Please enter your city' });
  if (!EMAIL_RE.test(a.email)) return res.status(400).json({ error: 'Please enter a valid email' });
  const digits = a.phone.replace(/\D/g, '').length;
  if (digits < 10 || digits > 15) return res.status(400).json({ error: 'Please enter a valid mobile number' });
  recentApplications.set(req.ip, [...times, now]);
  const user = currentUser(req);
  store.applications.unshift({
    id: crypto.randomBytes(8).toString('hex'),
    ...a,
    userId: user?.id,
    status: 'new',
    createdAt: new Date().toISOString(),
  });
  store.applications.length = Math.min(store.applications.length, 2000);
  save();
  if (store.notifySettings.onEarn) await alertOwner(notify.earnMessage(a));
  res.json({ ok: true });
});

// Sends a WhatsApp alert to the owner. A failed alert never stops the order.
// On Vercel it is awaited (the server may pause right after answering); elsewhere it runs in the background.
function alertOwner(text) {
  const n = store.notifySettings;
  if (!n.phone || !n.apiKey) return null;
  const sending = notify.sendWhatsApp(n, text).then((result) => {
    if (!result.ok) console.error('WhatsApp alert failed:', result.error);
  });
  return storage.cloud ? sending : null;
}

// Admin: WhatsApp alerts. The API key is never sent back, only whether one is saved.
const publicNotify = () => {
  const { apiKey, ...rest } = store.notifySettings;
  return { ...rest, hasApiKey: Boolean(apiKey) };
};

app.get('/api/admin/notify', requireAdmin, (req, res) => res.json(publicNotify()));

app.put('/api/admin/notify', requireAdmin, (req, res) => {
  const phone = str(req.body.phone, 25);
  const normalized = notify.normalizePhone(phone);
  if (phone && !normalized) return res.status(400).json({ error: 'Please enter the WhatsApp number with country code, e.g. 923001234567' });
  const apiKey = str(req.body.apiKey, 40).replace(/\s/g, '');
  store.notifySettings = {
    ...store.notifySettings,
    phone: normalized,
    apiKey: req.body.removeApiKey ? '' : apiKey || store.notifySettings.apiKey,
    onOrder: Boolean(req.body.onOrder),
    onEarn: Boolean(req.body.onEarn),
  };
  save();
  res.json(publicNotify());
});

app.post('/api/admin/notify/test', requireAdmin, async (req, res) => {
  const result = await notify.sendWhatsApp(store.notifySettings, `✅ Test from ${store.settings.storeName}: WhatsApp alerts are working.`);
  store.notifySettings.lastTest = { ok: result.ok, error: result.error || '', at: new Date().toISOString() };
  save();
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

// Admin: pages, size guide and location
app.put('/api/admin/content', allow('content'), (req, res) => {
  const old = contentImages(store.content);
  store.content = sanitizeContent(req.body, { str, safeUrl, isUploadUrl: storage.isUploadUrl });
  old.filter((src) => !isImageInUse(src)).forEach(removeUpload);
  save();
  res.json(store.content);
});

// Admin: "Earn with us" forms
const APPLICATION_STATUSES = ['new', 'contacted', 'approved', 'rejected'];

app.get('/api/admin/applications', allow('earn'), (req, res) => res.json(store.applications));

app.patch('/api/admin/applications/:id', allow('earn'), (req, res) => {
  const a = store.applications.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Form not found' });
  if (APPLICATION_STATUSES.includes(req.body.status)) a.status = req.body.status;
  save();
  res.json(a);
});

app.delete('/api/admin/applications/:id', allow('earn'), (req, res) => {
  const idx = store.applications.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Form not found' });
  store.applications.splice(idx, 1);
  save();
  res.json({ ok: true });
});

// Admin: delivery charges
app.put('/api/admin/delivery', allow('payments'), (req, res) => {
  const cityFees = (Array.isArray(req.body.cityFees) ? req.body.cityFees : [])
    .map((c) => ({ city: str(c?.city, 60), fee: num(c?.fee) ?? 0 }))
    .filter((c) => c.city)
    .slice(0, 100);
  store.deliverySettings = { fee: num(req.body.fee) ?? 0, freeAbove: num(req.body.freeAbove) ?? 0, cityFees };
  save();
  res.json(store.deliverySettings);
});

// Admin: collections
app.put('/api/admin/collections', allow('products'), (req, res) => {
  const productIds = new Set(store.products.map((p) => p.id));
  const list = (Array.isArray(req.body.collections) ? req.body.collections : []).slice(0, 30).map((c) => ({
    id: /^[a-f0-9]{12}$/.test(c?.id) ? c.id : crypto.randomBytes(6).toString('hex'),
    name: str(c?.name, 60),
    description: str(c?.description, 200),
    showOnHome: c?.showOnHome !== false,
    productIds: [...new Set((Array.isArray(c?.productIds) ? c.productIds : []).filter((id) => productIds.has(id)))],
  }));
  if (list.some((c) => !c.name)) return res.status(400).json({ error: 'Every collection needs a name' });
  store.collections = list;
  save();
  res.json(store.collections);
});

// Admin: reviews
const REVIEW_STATUSES = ['pending', 'approved', 'hidden'];

app.get('/api/admin/reviews', allow('reviews'), (req, res) => res.json(store.reviews));

app.patch('/api/admin/reviews/:id', allow('reviews'), (req, res) => {
  const r = store.reviews.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Review not found' });
  if (REVIEW_STATUSES.includes(req.body.status)) r.status = req.body.status;
  save();
  res.json(r);
});

app.delete('/api/admin/reviews/:id', allow('reviews'), (req, res) => {
  const idx = store.reviews.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Review not found' });
  store.reviews.splice(idx, 1);
  save();
  res.json({ ok: true });
});

// Admin: staff logins (owner only)
const publicStaff = ({ passwordHash, tokenVersion, ...rest }) => rest;

app.get('/api/admin/staff', requireAdmin, (req, res) =>
  res.json({ staff: store.staff.map(publicStaff), permissions: STAFF_PERMISSIONS })
);

app.post('/api/admin/staff', requireAdmin, (req, res) => {
  const id = str(req.body.id, 20);
  const existing = id && store.staff.find((m) => m.id === id);
  if (id && !existing) return res.status(404).json({ error: 'Staff member not found' });
  const name = str(req.body.name, 60);
  const username = str(req.body.username, 30).toLowerCase();
  const password = str(req.body.password, 200);
  const permissions = (Array.isArray(req.body.permissions) ? req.body.permissions : []).filter((p) => Object.hasOwn(STAFF_PERMISSIONS, p));
  if (!name) return res.status(400).json({ error: 'Please enter a name' });
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return res.status(400).json({ error: 'Username: 3–30 small letters, numbers, dot, dash or underscore' });
  if (store.staff.some((m) => m.username === username && m.id !== id)) return res.status(400).json({ error: 'This username is already taken' });
  if (!permissions.length) return res.status(400).json({ error: 'Choose at least one thing this person can do' });
  if ((!existing || password) && password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const active = req.body.active !== false;
  const member = existing || { id: crypto.randomBytes(6).toString('hex'), tokenVersion: 1, createdAt: new Date().toISOString() };
  // A new password, fewer permissions or switching off logs them out everywhere
  if (existing && (password || !active || existing.permissions.some((p) => !permissions.includes(p)))) member.tokenVersion += 1;
  Object.assign(member, { name, username, permissions, active });
  if (password) member.passwordHash = hashPassword(password);
  if (!existing) store.staff.push(member);
  save();
  res.json(publicStaff(member));
});

app.delete('/api/admin/staff/:id', requireAdmin, (req, res) => {
  const idx = store.staff.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Staff member not found' });
  store.staff.splice(idx, 1);
  save();
  res.json({ ok: true });
});

// Admin: backup — one zip with all data (data.json) and every picture (owner only)
app.get('/api/admin/backup', requireAdmin, async (req, res, next) => {
  try {
    const archiver = require('archiver');
    const { admin, secret, ...data } = store;
    data.notifySettings = { ...store.notifySettings, apiKey: '' };
    const images = new Set([
      ...store.products.flatMap((p) => p.images || []),
      ...(store.settings.slides || []).map((s) => s.image),
      ...contentImages(store.content),
    ]);
    const receipts = store.orders.filter((o) => o.manualPayment?.receipt).map((o) => o.manualPayment);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="store-backup-${stamp}.zip"`);
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('warning', (err) => console.warn(err));
    zip.on('error', (err) => {
      console.error(err);
      res.destroy(err);
    });
    zip.pipe(res);
    zip.append(JSON.stringify(data, null, 2), { name: 'data.json' });
    zip.append(
      `Backup of ${store.settings.storeName}, ${new Date().toLocaleString('en-PK')}\n\n` +
        'data.json: products, orders, customers, pages, settings (passwords and keys are left out).\n' +
        'pictures/: product, slider and page pictures. receipts/: payment screenshots.\n',
      { name: 'README.txt' }
    );
    const addFile = async (src, folder) => {
      const name = `${folder}/${path.basename(src.split('?')[0])}`;
      if (src.startsWith('/uploads/')) {
        const file = path.join(storage.UPLOAD_DIR, path.basename(src));
        if (require('fs').existsSync(file)) zip.file(file, { name });
      } else if (/^https:\/\//.test(src)) {
        const r = await fetch(src, { signal: AbortSignal.timeout(20000) }).catch(() => null);
        if (r?.ok) zip.append(Buffer.from(await r.arrayBuffer()), { name });
      }
    };
    for (const src of images) await addFile(src, 'pictures');
    for (const m of receipts) {
      if (m.receiptUrl) await addFile(m.receiptUrl, 'receipts');
      else if (require('fs').existsSync(storage.receiptPath(m.receipt))) zip.file(storage.receiptPath(m.receipt), { name: `receipts/${m.receipt}` });
    }
    await zip.finalize();
  } catch (err) {
    next(err);
  }
});

// Admin: customers
app.get('/api/admin/users', allow('customers'), (req, res) => {
  res.json(
    store.users.map((u) => {
      const orders = store.orders.filter((o) => o.userId === u.id && !LOST_STATUSES.includes(o.status));
      return { ...publicUser(u), orderCount: orders.length, spent: orders.reduce((n, o) => n + o.total, 0) };
    })
  );
});

app.put('/api/admin/users/:id', allow('customers'), (req, res) => {
  const user = store.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Customer not found' });
  const [profile, error] = sanitizeProfile(req.body, user.id);
  if (error) return res.status(400).json({ error });
  const newPassword = str(req.body.newPassword, 200);
  if (newPassword && newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const blocked = Boolean(req.body.blocked);
  // A new password or blocking logs the customer out of every device
  if (newPassword || (blocked && !user.blocked)) user.tokenVersion += 1;
  if (newPassword) user.passwordHash = hashPassword(newPassword);
  Object.assign(user, profile, { blocked, updatedAt: new Date().toISOString() });
  save();
  res.json(publicUser(user));
});

app.delete('/api/admin/users/:id', allow('customers'), (req, res) => {
  const idx = store.users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Customer not found' });
  store.users.splice(idx, 1); // their orders stay, with the delivery details on them
  save();
  res.json({ ok: true });
});

app.put('/api/admin/account-settings', allow('customers'), (req, res) => {
  store.accountSettings = { allowRegistration: Boolean(req.body.allowRegistration), requireLogin: Boolean(req.body.requireLogin) };
  save();
  res.json(store.accountSettings);
});

// Admin: payment methods
app.get('/api/admin/payment-settings', allow('payments'), (req, res) => {
  res.json({ ...store.paymentSettings, gateways: { safepay: SAFEPAY.enabled, easypaisa: EASYPAISA.enabled } });
});

app.put('/api/admin/payment-settings', allow('payments'), (req, res) => {
  const accounts = Array.isArray(req.body.manualAccounts) ? req.body.manualAccounts.slice(0, 20).map(sanitizeManualAccount) : [];
  const incomplete = accounts.find((a) => !a.accountTitle || !(a.accountNumber || a.iban));
  if (incomplete) return res.status(400).json({ error: 'Every account needs an account title and an account number or IBAN' });
  const cod = Boolean(req.body.cod);
  if (!cod && !accounts.some((a) => a.enabled) && !SAFEPAY.enabled && !EASYPAISA.enabled) {
    return res.status(400).json({ error: 'Keep at least one payment method on, or customers cannot order' });
  }
  store.paymentSettings = { cod, manualAccounts: accounts };
  save();
  res.json({ ...store.paymentSettings, gateways: { safepay: SAFEPAY.enabled, easypaisa: EASYPAISA.enabled } });
});

// Settings
app.put('/api/admin/settings', allow('content'), (req, res) => {
  const body = req.body || {};
  const social = body.social || {};
  const oldSlides = store.settings.slides || [];
  store.settings = {
    storeName: str(body.storeName, 60) || store.settings.storeName,
    tagline: str(body.tagline, 160),
    currency: str(body.currency, 8) || 'Rs.',
    announcement: str(body.announcement, 200),
    heroTitle: str(body.heroTitle, 120),
    heroSubtitle: str(body.heroSubtitle, 300),
    categories: list(body.categories),
    slides: sanitizeSlides(body.slides),
    sliderShape: body.sliderShape === 'portrait' ? 'portrait' : 'landscape',
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
  oldSlides.filter((s) => !isImageInUse(s.image)).forEach((s) => removeUpload(s.image));
  save();
  res.json(store.settings);
});

// Static files
app.use('/uploads', express.static(storage.UPLOAD_DIR, { maxAge: '30d' }));
// no-cache: the browser may keep a copy but must check with the server first,
// so updated pages, scripts and styles show up right after the server is updated.
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

// On Vercel the app is imported and run for each request; on your own computer it listens on a port.
module.exports = app;

if (require.main === module) {
  loadStore().then((loaded) => {
    store = loaded;
    app.listen(PORT, () => startupMessage());
  });
}

function startupMessage() {
  console.log(`Store running:      http://localhost:${PORT}`);
  console.log(`Admin dashboard:    http://localhost:${PORT}/admin`);
  if (freshStore) {
    console.log(`First login password: "${process.env.ADMIN_PASSWORD ? '(your ADMIN_PASSWORD)' : 'admin123'}" - the dashboard will then ask you to set a strong password.`);
  } else if (store.admin.mustChangePassword) {
    console.log('Admin: log in with your current password - the dashboard will ask you to set a strong one.');
  }
  console.log(`Google Authenticator for admin login: ${store.admin.totp ? 'ON' : 'OFF (turn on in Dashboard > Security)'}`);
  console.log(SAFEPAY.enabled ? `Safepay online payments: ON (${SAFEPAY.env})` : 'Safepay online payments: OFF (set SAFEPAY_API_KEY and SAFEPAY_SECRET_KEY)');
  console.log(
    EASYPAISA.enabled
      ? `Easypaisa payments: ON (${EASYPAISA.env})`
      : 'Easypaisa payments: OFF (set EASYPAISA_STORE_ID, EASYPAISA_HASH_KEY, EASYPAISA_USERNAME, EASYPAISA_PASSWORD, EASYPAISA_ACCOUNT_NUM)'
  );
}
