// Emergency admin reset: sets a new temporary password and turns off Google Authenticator.
// Use it if the admin password or phone is lost. Stop the server first (Ctrl + C), then run:
//   npm run reset-admin
// Log in with the printed password; the dashboard then asks for a new strong password.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '..', 'data', 'store.json');
if (!fs.existsSync(STORE_FILE)) {
  console.log('No data/store.json yet - just start the server and log in with admin123.');
  process.exit(0);
}

const store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
const temp = `Temp-${crypto.randomBytes(4).toString('hex')}!${crypto.randomInt(10, 99)}`;
const salt = crypto.randomBytes(16).toString('hex');
store.admin = {
  ...store.admin,
  passwordHash: `${salt}:${crypto.scryptSync(temp, salt, 64).toString('hex')}`,
  mustChangePassword: true,
  totp: null,
  recoveryCodes: [],
};
const tmp = `${STORE_FILE}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
fs.renameSync(tmp, STORE_FILE);

console.log('Admin reset done. Google Authenticator is OFF.');
console.log(`Temporary password: ${temp}`);
console.log('Start the server (npm start), log in with it, and set a new strong password.');
