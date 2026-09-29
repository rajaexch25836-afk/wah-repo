// Emergency admin reset: sets a new temporary password and turns off Google Authenticator.
// Use it if the admin password or phone is lost.
//
// On your own computer: stop the server first (Ctrl + C), then run:
//   npm run reset-admin
// For a store on Vercel: copy KV_REST_API_URL and KV_REST_API_TOKEN from
// Vercel > Project > Settings > Environment Variables, then run:
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... npm run reset-admin
//
// Log in with the printed password; the dashboard then asks for a new strong password.
const crypto = require('crypto');
const storage = require('../lib/storage');

(async () => {
  const store = await storage.loadData();
  if (!store) {
    console.log('No saved store yet - just start the server and log in with admin123.');
    return;
  }
  const temp = `Temp-${crypto.randomBytes(4).toString('hex')}!${crypto.randomInt(10, 99)}`;
  const salt = crypto.randomBytes(16).toString('hex');
  store.admin = {
    ...store.admin,
    passwordHash: `${salt}:${crypto.scryptSync(temp, salt, 64).toString('hex')}`,
    mustChangePassword: true,
    sessionVersion: (store.admin?.sessionVersion || 1) + 1, // logs out every device
    totp: null,
    recoveryCodes: [],
  };
  await storage.saveData(store);

  console.log('Admin reset done. Google Authenticator is OFF.');
  console.log(`Temporary password: ${temp}`);
  console.log('Log in with it and set a new strong password.');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
