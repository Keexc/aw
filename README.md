# Kenyan Excellence Awards — Voting Platform

A public voting site: KSh 20/vote via M-Pesa STK Push (through FXS Pay),
unlimited votes per person, live public results, and an admin dashboard
for managing categories, nominees, and payments.

## Structure

```
backend/    Express API + Supabase (deploy to Render)
frontend/   Public site + admin dashboard (static HTML/JS — deploy to GitHub Pages
            or any static host)
```

## 1. Set up Supabase

1. Create a Supabase project.
2. Open the SQL editor and run `backend/schema.sql`.
3. Copy your project URL and **service role key** (Settings → API) — you'll
   need these for the backend `.env`. The service role key is server-only;
   never put it in the frontend.

## 2. Configure the backend

```
cd backend
cp .env.example .env
npm install
```

Fill in `.env`:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — from step 1
- `JWT_SECRET` — any long random string
- `FXS_*` values — **see the note below**

Create your first admin login:
```
node create-admin.js you@example.com "a-strong-password" "Your Name"
```

Run locally:
```
npm run dev
```

Deploy to Render the same way you deploy your other Node/Express APIs —
either connect the `keexc/bc` repo directly (Render auto-detects
`npm start`), or use the included `backend/render.yaml` Blueprint (New →
Blueprint in Render, point it at the repo). Either way, the `sync: false`
variables in `render.yaml` (JWT_SECRET, SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY, FXS_API_KEY, FXS_WEBHOOK_SECRET) still need to
be filled in manually from the dashboard — Blueprints don't auto-fill
secrets.

## 3. Paystack setup

`routes/payments.js` calls Paystack's Charge API directly (Mobile
Money/M-Pesa channel) — no third-party aggregator in between.

1. **Get your secret key** from the Paystack dashboard → Settings → API
   Keys & Webhooks. Use `sk_test_...` while testing, switch to
   `sk_live_...` once confirmed working. Put it in `.env` as
   `PAYSTACK_SECRET_KEY`.
2. **Confirm Mobile Money is enabled** on your account for Kenya (Settings
   → Preferences → Accept payments via → Mobile Money) — this is what
   makes the M-Pesa STK push channel available.
3. **Deploy the backend** (Render), then set the webhook URL in the
   Paystack dashboard (Settings → API Keys & Webhooks → Webhook URL):
   ```
   https://your-backend.onrender.com/api/payments/webhook
   ```
   Unlike FXS Pay, there's no separate webhook secret to generate —
   Paystack signs webhook payloads with the same secret key you already
   have, so nothing extra to copy into `.env`.
4. **Test with a small real vote first** and check the actual amount
   charged on your phone. Paystack's Kenya example in their own docs
   sends `amount` as whole KES (not subunits like NGN's kobo), which is
   what this code assumes — but that's worth confirming directly rather
   than trusting blindly, since getting it wrong means over- or
   under-charging every voter.

How it works: `/api/payments/initiate` calls Paystack's `/charge` endpoint
with `mobile_money: { phone, provider: 'mpesa' }`, which returns a
`reference` synchronously (no async "did it even send" ambiguity like FXS
Pay had). `/api/payments/webhook` verifies Paystack's HMAC-SHA512
signature and credits votes on `charge.success`. The status endpoint also
falls back to Paystack's Verify Transaction API if a webhook hasn't
arrived within the request window.

## 4. Configure and deploy the frontend

In `frontend/js/app.js` and `frontend/js/admin.js`, either set
`window.KEA_API_BASE` before the script loads, or edit the `API_BASE`
fallback directly to point at your deployed Render URL, e.g.:

```html
<script>window.KEA_API_BASE = 'https://your-api.onrender.com/api';</script>
<script src="js/app.js"></script>
```

Then push `frontend/` to GitHub Pages as usual.

## 5. Notes on the categories that include real public figures

The politics category (and any entertainment nominees who are real named
individuals) means real people's names, photos, and bios will appear
attached to a paid competition. Worth confirming you have the standing to
do that — sponsor backing, nominee awareness, or at minimum a clear public
disclaimer — before opening voting on those categories specifically. The
admin dashboard lets you open/close voting per category, so you can launch
entertainment categories immediately and hold back politics until that's
settled.
