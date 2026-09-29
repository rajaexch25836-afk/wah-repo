# WAH Clothing — Online Store + Dashboard

Kapron (clothes) ki online shop, apne admin dashboard ke saath.

- **Customer site** (`/`) — mobile aur desktop dono pe sahi dikhti hai. Categories, search, sort, sale/sold-out badges, product pictures, size/colour select, bag (cart) aur **checkout**: customer first name, last name, contact number, email (optional), poora address, city aur notes bharta hai, phir **Cash on Delivery**, **Bank / Easypaisa / JazzCash transfer**, **Easypaisa** ya **Pay online (Safepay)** chunta hai.
- **Customer account** — customer register / login kar sakta hai (email ya mobile number se). "My account" me har order ki step-by-step halat (tareekh ke saath), apni details aur password change, aur "Earn with us" ka button.
- **Customer ki aasani:** har product pe **♡ wishlist** (login ho to har device pe), **Filters** (size, colour, price), har product ka apna **link + WhatsApp share**, **saved addresses** (Home, Office — checkout pe ek click), "New" order ko **khud cancel**, **Forgot password** (request dashboard ke Customers tab aur WhatsApp pe aati hai; aap naya password set kar ke customer ko WhatsApp kar dete hain), aur **Loyalty points** (delivered order pe points, agli dafa checkout pe discount — Customers tab me on/off aur rate).
- **Footer** — About us, Shipping policy, Return & exchange policy, Terms & conditions, **Earn with us** (form: naam, city, email, mobile — dashboard me aata hai aur customer WhatsApp pe bhi bhej sakta hai), **Track your order** (order number + mobile number se, bina account ke) aur **Visit our shop** (dukaan ka address, chhota map aur Google Maps link).
- **Size guide** — product pe size ke saath "Size guide" link; table ya picture dikhata hai. Login hone pe checkout me naam, phone aur address khud bhar jaata hai.
- **Dashboard** (`/admin`) — password se login. Yahan se aap:
  - **Orders** tab me har order customer ki poori detail ke saath dekh sakte hain (naam, phone, WhatsApp, address, items, total, payment), status badal sakte hain (New → Order confirmed → Order packing → Ready to deliver → Order picked → Shipped → Delivered / Returned / Rejected / Cancelled). Har order pe in sab ke ek-click "Mark as" buttons hain, aur customer ko har step tareekh ke saath nazar aata hai. Upar har status ki ginti aur raqam, **Net sales** (Returned, Rejected aur Cancelled ke baghair) aur **Payment received** dikhte hain; kisi bhi card pe click karne se wohi orders filter ho jaate hain aur COD order ko "Mark as paid" kar sakte hain. Easypaisa order pe **Check payment** dabane se Easypaisa se payment ki taaza halat aa jaati hai
  - **Customers** tab: saare registered customers, unke orders aur kharcha; customer ki details edit, naya password set, **Block / Unblock** aur **Delete**. Yahin se "naye customers register kar saken" aur "order ke liye login zaroori" on/off hota hai
  - **Payments** tab: Cash on delivery on/off, aur **Bank / Easypaisa / JazzCash accounts** add / edit / hide / remove (bank ka naam, account title, account number, IBAN, customer ke liye note)
  - Product add / edit / delete kar sakte hain
  - Naam (rename), price, sale price, description, sizes, colours change kar sakte hain. Colours ke liye 35 tayyar rang (chip daba kar lagayein) ya apne naam likhein; store pe rang ka chhota gola dikhta hai
  - Pictures upload / remove / "Make main" kar sakte hain
  - Ek click me **On sale**, **Sold out**, **Trending** laga/hata sakte hain
  - **Store & Social** tab me **Home page slider**: shape chunein — **Landscape** (chaudi banner, best size **1920 × 820 px**; phone pe beech ka hissa dikhta hai) ya **Portrait** (Instagram post jaisi, best size **1080 × 1350 px**; computer pe 3 saath, phone pe ek ek). Har picture ke neeche uska size likha aata hai aur agar shape ya size theek na ho to laal warning. 6 tak pictures upload karein, har picture pe heading aur text (optional), aage peechay karein ya hatayein. Yeh store ke upar slide hoti hain (mobile pe ungli se swipe). Tabdeeli foran save hoti hai
  - **Store & Social** tab me store ka naam, heading, announcement bar, categories aur social links (WhatsApp, Instagram, Facebook, TikTok, YouTube, Email, Phone) set kar sakte hain — jo field khali chhorenge woh website pe nahi dikhega
  - **Pages** tab: Size guide (text/table aur picture), dukaan ki location, aur About us, Shipping, Return, Terms, Earn with us — har page ka title, text aur picture
  - **Earn with us** tab: bhare hue forms (call, WhatsApp, email links), status New / Contacted / Approved / Rejected, delete
  - **WhatsApp alerts** (Store & Social tab ke neeche): har naye order (aur chahein to "Earn with us" form) pe aapke WhatsApp pe khud message. Free CallMeBot service se: phone me **+34 684 78 33 47** save karein, us ko WhatsApp pe `I allow callmebot to send me messages` bhejein, jo **API key** aaye woh apne number ke saath yahan daalein, save karein aur "Send test message" dabayein
  - **Collections** tab: "Eid Collection", "Winter Sale" jaise groups — products chunein; store pe button aur (chahein to) home page pe alag row
  - **Reviews** tab: customer har product pe stars aur comment deta hai; aap **Approve** karein to store pe dikhta hai (Hide / Delete bhi). Login customer ne woh product khareeda ho to "Verified buyer"
  - **Products** tab me products ko **drag** (ya ↑ ↓) kar ke tarteeb badlein — store pe "Featured" isi tarteeb se
  - **Payments & Delivery** tab: **delivery charge** (normal), kuch shehron ka alag charge, aur itne se upar **free delivery**; checkout me subtotal + delivery + total dikhta hai
  - **Pages & Popup** tab: **Offer popup** — picture, heading, text, button; on/off. Har visitor ko din me ek dafa dikhta hai
  - **Orders** tab: har order pe **🖨 Slip** (parcel pe lagane wali parchi: naam, phone, address, items, COD raqam) aur upar **Print slips** se list ke saare orders ek saath
  - **Staff** tab (sirf owner): staff ke alag login (username + password) aur har ek ke kaam chunein — jaise packing wala sirf Orders dekhe, price na badal sake. Staff login page pe apna username likhta hai
  - **Security & Backup** tab: **Download backup** — saara data (data.json) aur saari pictures ek .zip me
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

**Vercel wali store ke liye:** Vercel → Settings → Environment Variables se `KV_REST_API_URL` aur `KV_REST_API_TOKEN` copy karein, aur apne computer pe project folder me chalayein:
```bash
KV_REST_API_URL=... KV_REST_API_TOKEN=... npm run reset-admin
```

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

### Vercel

Vercel pe files save nahi hoti, is liye wahan data **Upstash Redis** me aur pictures **Vercel Blob** me jaati hain (dono ka free plan hai). Yeh ek dafa set karna hai:

1. Vercel pe project kholein → **Storage** tab.
2. **Create Database → Upstash (Redis)** chunein, free plan, aur project se **Connect** karein. Is se `KV_REST_API_URL` aur `KV_REST_API_TOKEN` khud add ho jaate hain.
3. Phir **Create → Blob** chunein aur project se **Connect** karein. Is se `BLOB_READ_WRITE_TOKEN` khud add ho jata hai.
4. **Settings → Environment Variables** me `PUBLIC_URL` add karein, jaise `https://bichkand-fashion.vercel.app` (login cookie ko https pe mehfooz rakhta hai).
5. **Deployments** me aakhri deployment ke **⋯ → Redeploy** dabayein.

Phir `https://<aapki-site>.vercel.app/admin` kholein, password `admin123` se login karein aur naya mazboot password rakhein.

Agar yeh setup na ho to website "Store setup is not finished" ka error dikhati hai.

Note: payment screenshots Blob me ek lambe random naam se save hote hain; dashboard unhe login ke baad hi dikhata hai.

### Apna server (VPS, Railway, Render)

Aisi hosting jo Node server chala sake aur files disk pe save rakhe: VPS (DigitalOcean, Hostinger VPS), Railway ya Render (persistent disk ke saath). Wahan kuch setup nahi chahiye — data `data/store.json` aur pictures `public/uploads/` me save hoti hain.

GitHub Pages pe dashboard nahi chalega kyun ke woh sirf static files dikhata hai.

`PORT` environment variable se port badal sakte hain.

## Files

| Path | Kaam |
|------|------|
| `server.js` | Backend: API, login, picture upload |
| `lib/notify.js` | WhatsApp alerts (CallMeBot) |
| `lib/content.js` | Pages, size guide aur location ka shuru ka text |
| `lib/storage.js` | Data aur pictures kahan save hon (disk, ya Vercel pe Redis + Blob) |
| `data/seed.json` | Shuru ka sample data |
| `public/index.html`, `public/css`, `public/js/app.js` | Customer website |
| `public/admin/` | Dashboard |
