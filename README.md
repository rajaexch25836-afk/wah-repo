# WAH Clothing — Online Store + Dashboard

Kapron (clothes) ki online shop, apne admin dashboard ke saath.

- **Customer site** (`/`) — mobile aur desktop dono pe sahi dikhti hai. Categories, search, sort, sale/sold-out badges, product pictures, size/colour select, bag (cart) aur **checkout**: customer first name, last name, contact number, email (optional), poora address, city aur notes bharta hai, phir **Cash on Delivery**, **Bank / Easypaisa / JazzCash transfer**, **Easypaisa** ya **Pay online (Safepay)** chunta hai.
- **Customer account** — customer register / login kar sakta hai (email ya mobile number se). "My account" me apni orders ki halat, apni details aur password change. Login hone pe checkout me naam, phone aur address khud bhar jaata hai.
- **Dashboard** (`/admin`) — password se login. Yahan se aap:
  - **Orders** tab me har order customer ki poori detail ke saath dekh sakte hain (naam, phone, WhatsApp, address, items, total, payment), status badal sakte hain (New → Confirmed → Shipped → Delivered / Returned / Rejected / Cancelled). Har order pe **Shipped, Delivered, Returned, Rejected** ke ek-click buttons hain. Upar har status ki ginti aur raqam, **Net sales** (Returned, Rejected aur Cancelled ke baghair) aur **Payment received** dikhte hain; kisi bhi card pe click karne se wohi orders filter ho jaate hain aur COD order ko "Mark as paid" kar sakte hain. Easypaisa order pe **Check payment** dabane se Easypaisa se payment ki taaza halat aa jaati hai
  - **Customers** tab: saare registered customers, unke orders aur kharcha; customer ki details edit, naya password set, **Block / Unblock** aur **Delete**. Yahin se "naye customers register kar saken" aur "order ke liye login zaroori" on/off hota hai
  - **Payments** tab: Cash on delivery on/off, aur **Bank / Easypaisa / JazzCash accounts** add / edit / hide / remove (bank ka naam, account title, account number, IBAN, customer ke liye note)
  - Product add / edit / delete kar sakte hain
  - Naam (rename), price, sale price, description, sizes, colours change kar sakte hain
  - Pictures upload / remove / "Make main" kar sakte hain
  - Ek click me **On sale**, **Sold out**, **Trending** laga/hata sakte hain
  - **Store & Social** tab me **Home page slider**: shape chunein — **Landscape** (chaudi banner, best size **1920 × 820 px**; phone pe beech ka hissa dikhta hai) ya **Portrait** (Instagram post jaisi, best size **1080 × 1350 px**; computer pe 3 saath, phone pe ek ek). Har picture ke neeche uska size likha aata hai aur agar shape ya size theek na ho to laal warning. 6 tak pictures upload karein, har picture pe heading aur text (optional), aage peechay karein ya hatayein. Yeh store ke upar slide hoti hain (mobile pe ungli se swipe). Tabdeeli foran save hoti hai
  - **Store & Social** tab me store ka naam, heading, announcement bar, categories aur social links (WhatsApp, Instagram, Facebook, TikTok, YouTube, Email, Phone) set kar sakte hain — jo field khali chhorenge woh website pe nahi dikhega
  - **Security** tab: admin password badlein (strong password zaroori; badalte hi baqi devices logout) aur **Google Authenticator** on/off karein

## Chalane ka tareeqa

Node.js 18+ chahiye.

```bash
npm install
npm start
```

- Store: http://localhost:3000
- Dashboard: http://localhost:3000/admin
- Pehla password: `admin123` — login karte hi dashboard **naya strong password** banwata hai, us ke baghair dashboard nahi khulta.
  (Ya server chalate waqt `ADMIN_PASSWORD=mera-password npm start` — yeh sirf pehli dafa data banne pe use hota hai.)

## Admin security

**Strong password:** kam az kam 10 characters, bara harf (A–Z), chhota harf (a–z), number, symbol (! @ # $), aur "admin", "password", "12345" jaise aasan lafz nahi. Purane (kamzor) password wale admin se bhi agli login pe ek dafa naya strong password banwaya jaata hai.

**Google Authenticator (2-step login):** Dashboard > **Security** > "Turn on Google Authenticator":
1. Apna admin password daalein.
2. Phone pe Google Authenticator app kholen → **+** → **Scan a QR code** → screen wala QR scan karein.
3. App ka 6-digit code daal kar **Turn on**.
4. **8 recovery codes** milenge — inhe copy/download karke mehfooz jagah rakhein. Phone gum ho jaye to har code ek dafa login ke kaam aata hai.

Iske baad login pe password ke baad phone ka code bhi maanga jaata hai.

**Phone aur recovery codes dono gum ho gaye / password bhool gaye?** Server wale computer pe:
```bash
# pehle server band karein (Ctrl + C)
npm run reset-admin
npm start
```
Yeh ek temporary password dikhata hai aur Google Authenticator band kar deta hai. Us se login karein, naya strong password banayein, aur Security tab se Authenticator dobara on kar lein.

Pehli dafa chalne pe `data/seed.json` se sample products aur settings `data/store.json` me copy ho jaati hain. Asal data `data/store.json` me aur pictures `public/uploads/` me save hoti hain (dono git me commit nahi hote, taake aapka live data safe rahe — inka backup rakhein).

## Bank / Easypaisa / JazzCash transfer (manual)

Dashboard > **Payments** me apne accounts daal dein. Checkout pe customer ko yeh details (copy button ke saath) dikhti hain. Customer paise bhejta hai, **Transaction ID (TID)** likhta hai aur chahe to payment ka screenshot laga deta hai. Order "Awaiting payment" me aata hai; Orders tab me TID aur screenshot dekh kar apne account me payment check karein aur **Mark as paid** dabayein.

Screenshots `data/receipts/` me save hote hain aur sirf admin login se dikhte hain.

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

Sab orders aur customer accounts `data/store.json` me save hote hain (passwords hash ho kar). Customer ka login 30 din tak yaad rehta hai. Ghalat password 8 dafa dene pe 15 minute ke liye login ruk jaata hai.

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
