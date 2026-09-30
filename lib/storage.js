// Where the store's data and pictures are kept.
//
// - On your own computer or a normal server: data/store.json and the public/uploads folder.
// - On Railway (or any host with a disk "volume"): everything goes in that volume, so it
//   survives restarts and new deploys. Railway tells us where it is (RAILWAY_VOLUME_MOUNT_PATH);
//   on other hosts set DATA_DIR to the volume folder.
// - On Vercel (files cannot be saved there): the data goes to Upstash Redis and the
//   pictures to Vercel Blob. Connect both to the project in the Vercel dashboard
//   (Storage tab) and their keys are added automatically.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VOLUME = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const DATA_DIR = VOLUME ? path.resolve(VOLUME) : path.join(ROOT, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const UPLOAD_DIR = VOLUME ? path.join(DATA_DIR, 'uploads') : path.join(ROOT, 'public', 'uploads');
const RECEIPT_DIR = path.join(DATA_DIR, 'receipts');

const REDIS_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const cloud = Boolean(process.env.VERCEL || REDIS_URL);

const KEY_STORE = 'wah:store';
const KEY_VERSION = 'wah:version';
const KEY_LOCK = 'wah:lock';

// Tells the owner what to set up instead of failing with a vague error.
function missingSetup() {
  const missing = [];
  if (!REDIS_URL || !REDIS_TOKEN) missing.push('Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN)');
  if (!process.env.BLOB_READ_WRITE_TOKEN) missing.push('Vercel Blob (BLOB_READ_WRITE_TOKEN)');
  return missing;
}

// ---------- Upstash Redis (REST API, no extra package needed) ----------

async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`Redis ${command[0]} failed: ${json.error || res.status}`);
  return json.result;
}

async function redisTransaction(commands) {
  const res = await fetch(`${REDIS_URL}/multi-exec`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(json) || json.some((r) => r.error)) {
    throw new Error(`Redis transaction failed: ${JSON.stringify(json).slice(0, 200)}`);
  }
}

// ---------- Store data ----------

let cached = null;
let cachedVersion = null;

// Returns the saved store, or null if nothing has been saved yet.
async function loadData() {
  if (!cloud) return fs.existsSync(STORE_FILE) ? JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) : null;
  const version = await redis(['GET', KEY_VERSION]);
  if (cached && version === cachedVersion) return cached;
  const raw = await redis(['GET', KEY_STORE]);
  cached = raw ? JSON.parse(raw) : null;
  cachedVersion = version;
  return cached;
}

async function saveData(data) {
  if (!cloud) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, STORE_FILE);
    return;
  }
  await redisTransaction([
    ['SET', KEY_STORE, JSON.stringify(data)],
    ['INCR', KEY_VERSION],
  ]);
  cached = null; // re-read next time so the version number matches
}

// Only one change at a time across all running copies of the server, so two orders
// placed at the same moment cannot overwrite each other. Returns a release function.
async function lock() {
  if (!cloud) return async () => {};
  const token = crypto.randomBytes(12).toString('hex');
  const deadline = Date.now() + 20000;
  while (!(await redis(['SET', KEY_LOCK, token, 'NX', 'PX', '25000']))) {
    if (Date.now() > deadline) throw new Error('The store is busy, please try again');
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 150));
  }
  return () =>
    redis(['EVAL', "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", '1', KEY_LOCK, token]).catch(
      (err) => console.error(err)
    );
}

// ---------- Pictures ----------

const blob = () => require('@vercel/blob');

// Product / slider pictures. Returns the address to show the picture from.
async function saveImage(buffer, ext, contentType) {
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  if (!cloud) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
    return `/uploads/${name}`;
  }
  const { url } = await blob().put(`uploads/${name}`, buffer, { access: 'public', contentType, addRandomSuffix: false });
  return url;
}

// Payment screenshots. The name is random and only admins are shown where it is.
// Returns { file, url } - url is only set on Vercel.
async function saveReceipt(buffer, ext, contentType) {
  const file = `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${ext}`;
  if (!cloud) {
    fs.mkdirSync(RECEIPT_DIR, { recursive: true });
    fs.writeFileSync(path.join(RECEIPT_DIR, file), buffer);
    return { file, url: null };
  }
  const { url } = await blob().put(`receipts/${file}`, buffer, { access: 'public', contentType, addRandomSuffix: false });
  return { file, url };
}

const receiptPath = (file) => path.join(RECEIPT_DIR, path.basename(file));

// Is this a picture address that this store created?
const BLOB_URL_RE = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/uploads\/[\w.-]+$/i;
const isUploadUrl = (src) => typeof src === 'string' && (src.startsWith('/uploads/') || BLOB_URL_RE.test(src));

function removeImage(src) {
  if (!isUploadUrl(src)) return Promise.resolve();
  if (src.startsWith('/uploads/')) return fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(src))).catch(() => {});
  return blob().del(src).catch((err) => console.error(err));
}

module.exports = {
  cloud,
  missingSetup,
  loadData,
  saveData,
  lock,
  saveImage,
  saveReceipt,
  receiptPath,
  isUploadUrl,
  removeImage,
  UPLOAD_DIR,
  DATA_DIR,
};
