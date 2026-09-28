# WAH Clothing — Online Store + Dashboard

Kapron (clothes) ki online shop, apne admin dashboard ke saath.

- **Customer site** (`/`) — mobile aur desktop dono pe sahi dikhti hai. Categories, search, sort, sale/sold-out badges, product pictures, size/colour select, bag (cart) aur **checkout**: customer first name, last name, contact number, email (optional), poora address, city aur notes bharta hai, phir **Cash on Delivery**, **Easypaisa** ya **Pay online (Safepay)** chunta hai.
- **Dashboard** (`/admin`) — password se login. Yahan se aap:
  - **Orders** tab me har order customer ki poori detail ke saath dekh sakte hain (naam, phone, WhatsApp, address, items, total, payment), status badal sakte hain (New → Confirmed → Shipped → Delivered / Cancelled) aur COD order ko "Mark as paid" kar sakte hain. Easypaisa order pe **Check payment** dabane se Easypaisa se payment ki taaza halat aa jaati hai
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

## Online payment (Safepay)

Online payment tab chalti hai jab server ko Safepay ki keys di jaayein. Keys na hon to checkout me sirf Cash on Delivery dikhta hai.

1. [getsafepay.com](https://getsafepay.com) pe merchant account banayein. Pehle **sandbox** (test) account se try karein.
2. Safepay dashboard > **Developers** se **API key** aur **Secret key** copy karein.
3. Server in environment variables ke saath chalayein:

```bash
SAFEPAY_ENV=sandbox \
SAFEPAY_API_KEY=aapki-api-key \
SAFEPAY_SECRET_KEY=aapki-secret-key \
PUBLIC_URL=https://aapki-website.com \
npm start
```

| Variable | Kaam |
|----------|------|
| `SAFEPAY_ENV` | `sandbox` (test) ya `production` (asli paise) |
| `SAFEPAY_API_KEY` | Safepay API key |
| `SAFEPAY_SECRET_KEY` | Safepay secret key — payment ki signature check karne ke liye. Kisi ko na dein, git me commit na karein |
| `PUBLIC_URL` | Aapki website ka poora address. Payment ke baad Safepay customer ko yahan wapas bhejta hai |

Kaise kaam karta hai: customer "Pay online" chunta hai → order "Awaiting payment" ke saath save hota hai → customer Safepay ke page pe pay karta hai → wapas aane pe server Safepay ki signature check karta hai aur order **Paid** ho jaata hai. Agar customer cancel kare to order Cancelled ho jaata hai aur uska bag waise hi rehta hai. Agar customer pay karke page band kar de aur order "Awaiting payment" reh jaaye, to Safepay dashboard me check karke "Mark as paid" kar dein.

Sab orders `data/store.json` me save hote hain.

## Easypaisa

Easypaisa option tab dikhta hai jab yeh paanch settings di jaayein (Easypaisa merchant account banane pe Easypaisa yeh deta hai):

| Variable | Kaam |
|----------|------|
| `EASYPAISA_ENV` | `sandbox` (test) ya `production` (asli paise) |
| `EASYPAISA_STORE_ID` | Store ID |
| `EASYPAISA_HASH_KEY` | Hash key (16, 24 ya 32 characters) |
| `EASYPAISA_USERNAME` | API username |
| `EASYPAISA_PASSWORD` | API password |
| `EASYPAISA_ACCOUNT_NUM` | Aapka Easypaisa merchant account number |

```bash
EASYPAISA_ENV=sandbox EASYPAISA_STORE_ID=... EASYPAISA_HASH_KEY=... \
EASYPAISA_USERNAME=... EASYPAISA_PASSWORD=... EASYPAISA_ACCOUNT_NUM=... \
PUBLIC_URL=https://aapki-website.com npm start
```

Kaise kaam karta hai: customer Easypaisa chunta hai → Easypaisa ke page pe pay karta hai → wapas aane pe server **Easypaisa ki Inquire Transaction API se khud poochta hai** ke order paid hai aur amount sahi hai, tab hi order **Paid** hota hai. (Easypaisa jo result browser ke zariye bhejta hai us pe signature nahi hota, is liye us pe bharosa nahi kiya jaata.) Agar customer page band kar de to dashboard me **Check payment** daba dein.

Easypaisa se yeh zaroor kahein ke aapke account pe **Hosted Checkout** aur **Inquire Transaction API** dono on hon, aur apni website ka address unke paas register karwa dein.

Sab keys sirf server pe environment variables me rakhein — git me commit na karein.

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
