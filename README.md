# WAH Clothing — Online Store + Dashboard

Kapron (clothes) ki online shop, apne admin dashboard ke saath.

- **Customer site** (`/`) — mobile aur desktop dono pe sahi dikhti hai. Categories, search, sort, sale/sold-out badges, product pictures, size/colour select, bag (cart), aur order seedha **WhatsApp** pe aata hai.
- **Dashboard** (`/admin`) — password se login. Yahan se aap:
  - Product add / edit / delete kar sakte hain
  - Naam (rename), price, sale price, description, sizes, colours change kar sakte hain
  - Pictures upload / remove / "Make main" kar sakte hain
  - Ek click me **On sale**, **Sold out**, **Trending** laga/hata sakte hain
  - **Store & Social** tab me store ka naam, heading, announcement bar, categories aur social links (WhatsApp, Instagram, Facebook, TikTok, YouTube, Email, Phone) set kar sakte hain — jo field khali chhorenge woh website pe nahi dikhega
  - Password change kar sakte hain

## Chalane ka tareeqa

Node.js 18+ chahiye.

```bash
npm install
npm start
```

- Store: http://localhost:3000
- Dashboard: http://localhost:3000/admin
- Pehla password: `admin123` — **login ke baad foran Store & Social > Change password se badal dein.**
  (Ya server chalate waqt `ADMIN_PASSWORD=mera-password npm start` — yeh sirf pehli dafa data banne pe use hota hai.)

Pehli dafa chalne pe `data/seed.json` se sample products aur settings `data/store.json` me copy ho jaati hain. Asal data `data/store.json` me aur pictures `public/uploads/` me save hoti hain (dono git me commit nahi hote, taake aapka live data safe rahe — inka backup rakhein).

## Online (live) karna

Yeh Node.js app hai, is liye aisi hosting chahiye jo Node server chala sake aur files disk pe save rakhe, maslan: VPS (DigitalOcean, Hostinger VPS), Railway ya Render (persistent disk ke saath). GitHub Pages pe dashboard nahi chalega kyun ke woh sirf static files dikhata hai.

`PORT` environment variable se port badal sakte hain.

## Files

| Path | Kaam |
|------|------|
| `server.js` | Backend: API, login, picture upload |
| `data/seed.json` | Shuru ka sample data |
| `public/index.html`, `public/css`, `public/js/app.js` | Customer website |
| `public/admin/` | Dashboard |
