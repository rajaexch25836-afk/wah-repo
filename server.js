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
    writeStore(seed);
    return seed;
  }
  return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
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
  res.json({ settings: store.settings, products: store.products });
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
});
