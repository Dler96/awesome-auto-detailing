# Awesome Auto Detailing — online booking website

A mobile-first, multi-page booking site for a car detailing shop.
**GitHub** stores the code · **Cloudflare Pages** hosts it · **Supabase** runs logins, the database and image storage.

## What customers can do
- **Check availability** — live month calendar and start times for the job they want, without logging in.
- **Customise a package** — pick vehicle size → main package → any add-ons. Price and bay time update live.
- **Book a slot** — the system reserves a bay for the full length of the job; double-booking is impossible (enforced in the database).
- **Pay their way** — pay at the shop, or scan your DuitNow QR and upload a receipt.
- **Manage bookings** — My Bookings: status, add to phone calendar, pay by QR later, reschedule, cancel, WhatsApp the shop, book again.
- **My garage** — saved cars for one-tap booking next time.

## What you (admin) can do
- **Today & schedule** — bay timeline, agenda, one-tap Confirm → Start job → Complete → Mark paid.
- **Booking details** — view QR receipts, internal notes, reschedule, and ready-made WhatsApp messages (Confirm, Reminder, Car ready, Payment verified).
- **All bookings** — search/filter, export CSV.
- **Services & prices** — packages and add-ons, bay time, photos, price per vehicle size.
- **Vehicle sizes, Hours & capacity** — opening hours, number of bays, slot spacing, minimum notice, how far ahead, cancel cut-off, holiday closures, address/maps link.
- **Payments, Promotions, Customers, Reports** — QR setup, home-page posters, customer history & booking pause, revenue reports.
- **New booking** — book for yourself, a registered customer, or a walk-in/phone customer.

---

## Setup (about 20 minutes)

### 1. Supabase (database + logins)
1. Create a new project at supabase.com. Region: Singapore is closest to Malaysia.
2. **SQL Editor → New query** → paste all of `database/01-setup.sql` → **Run**. (Run it once, on a new project.)
3. **Authentication → Sign In / Providers → Email**: keep Email enabled and turn **OFF "Confirm email"**. Customer usernames are turned into internal addresses that cannot receive mail, so confirmation must be off.
4. **Authentication → Users → Add user**: create *your* admin login with your real email and a strong password. Copy its **UID**.
5. Open `database/02-grant-admin.sql`, replace `REPLACE_WITH_ADMIN_USER_UUID` with that UID, run it in the SQL Editor.
6. **Project Settings → API**: copy the **Project URL** and the **publishable key** (or legacy *anon* key). Never use the `service_role`/secret key on the website.

### 2. Website settings
Edit `public/config.js`:
- `supabaseUrl` and `supabaseKey` from step 1.6
- `whatsapp`: your number, e.g. `60123456789` (country code, no + or spaces)
- optional `instagram`, `tiktok`, `facebook` links (full `https://` URLs)

### 3. GitHub
Create a repository and upload this whole folder (keep the `public` and `database` folders).

### 4. Cloudflare Pages (hosting)
1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → choose the repo.
2. Framework preset **None** · Build command `exit 0` · Build output directory **`public`** → Deploy.
3. Optional: add your own domain under **Custom domains**.
4. Back in Supabase → **Authentication → URL Configuration**: set **Site URL** to your website address and add `https://YOUR-SITE/account` to **Redirect URLs** (used by the admin password-reset email).

Every time you push to GitHub, Cloudflare redeploys automatically.

### 5. First login and shop setup
1. Open your site → **Log in** → tap **Admin / email login** → sign in with the admin email from step 1.4.
2. Go to **Admin**, then work through:
   - **Services & prices** — the starter packages and prices are **samples**. Edit names, bay time and every price.
   - **Vehicle sizes** — rename or add sizes to match how you price.
   - **Hours & capacity** — opening hours, **number of bays**, notice period, cancel cut-off, address and Google Maps link.
   - **Payments** — upload your DuitNow QR and recipient name, or switch QR off.
   - **Promotions** — optional posters for the home page.

### 6. Test before launch (on your phone)
- Register a customer account (username + password), book with **Pay at shop**, then with **QR + receipt**.
- In Admin → Today: Confirm, Start job, Complete, Mark paid; open the receipt; send a WhatsApp template.
- As the customer: reschedule, cancel, add to calendar, check My garage.
- Fill every bay at one time and confirm that time shows **Full** on the Availability page.

---

## Good to know
- **Times** are always Malaysia time (Asia/Kuala_Lumpur).
- **Bays**: a booking holds one bay from its start time for the total bay time of its package + add-ons. The database blocks overlaps even if two people tap at the same moment.
- **Booking status**: Online bookings start as *Awaiting confirmation*; admin bookings are confirmed immediately. A customer reschedule puts the booking back to *Awaiting confirmation*.
- **Limits**: customers can hold up to 3 upcoming bookings and save up to 10 cars; jobs over 12 hours must be split.
- **QR receipts are not automatic bank verification.** Always check your bank/e-wallet before marking *Paid*. Receipts are private (only the customer and admins can open them).
- **Forgotten passwords**: username accounts have no mailbox, so the login page sends customers to your WhatsApp. To give them a temporary password, run this in the SQL Editor (change the username and password), then ask them to change it in My account:
  ```sql
  update auth.users set encrypted_password = extensions.crypt('Temp1234!', extensions.gen_salt('bf'))
  where email = 'theirusername@accounts.awesomeauto.invalid';
  ```
- **Holiday closures** stop new bookings on that day but do not cancel existing ones — check Admin → All bookings for that date.
- **More admins**: have them register on the site, copy their UID from Supabase → Authentication → Users, and run `02-grant-admin.sql` with it.

## WhatsApp (now and later)
Right now WhatsApp works with **click-to-chat links** (no setup, free): customers message you from their booking, and admins send ready-written messages to customers with one tap.
Later, with **Meta WhatsApp Cloud API**, you can send automatic confirmations and reminders. That needs a Supabase Edge Function (server code holding your Meta token — never put the token in this website) triggered when a booking is created or changes status. The booking data and phone numbers are already stored in the right shape for it.

## File map
```
public/                      ← the website (Cloudflare serves this folder)
  index.html                 Home
  services.html              Services & prices
  availability.html          Live availability calendar
  book.html                  Booking wizard
  my-bookings.html           Customer bookings
  account.html               Log in / register / profile / garage
  admin.html                 Admin dashboard
  404.html                   Not-found page
  config.js                  Your Supabase + WhatsApp settings (public values only)
  _headers                   Security headers for Cloudflare
  assets/css/site.css        Design and mobile layout
  assets/js/core.js          Shared: header, bottom tab bar, login session, catalogue
  assets/js/scheduler.js     Calendar + time-slot picker
  assets/js/*.js             One script per page
  assets/logo.webp …         Logo and icon
database/
  01-setup.sql               Full database: tables, security, booking engine, sample services
  02-grant-admin.sql         Makes an account an admin
```
