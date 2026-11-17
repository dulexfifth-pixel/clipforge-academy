# Clipforge Academy

A Node.js website with a $7.99 USD monthly Paystack checkout.

## Project files
- `public/index.html` — Clipforge Academy frontend
- `server.js` — checkout, payment verification, session and webhook backend
- `scripts/create-plans.js` — creates the monthly USD Paystack plan
- `.env.example` — safe environment-variable template

## Local setup
Requires Node.js 20 or newer.

1. Copy `.env.example` to `.env`.
2. Install dependencies: `npm install`.
3. Add the Paystack **test** secret key to the private `.env` file.
4. Create the plan: `npm run create-plans`.
5. Copy the printed plan code into `PAYSTACK_MONTHLY_PLAN_CODE` in `.env`.
6. Set `APP_URL=http://localhost:4242`.
7. Run `npm start` and open `http://localhost:4242`.

Never commit `.env`, real API keys, or database files.

## Hosting
Deploy as a Node.js 20+ web service. Build command: `npm install`. Start command: `npm start`. Configure these environment variables in the hosting dashboard:
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_MONTHLY_PLAN_CODE`
- `APP_URL` (your public HTTPS domain)
- `DB_FILE` (a path on persistent disk)

Configure the Paystack webhook to:
`https://YOUR-DOMAIN/api/paystack/webhook`

The SQLite database must be stored on persistent disk. Test the entire checkout and callback flow using Paystack test credentials before considering a live launch.

## Payment-account safety
A parent/guardian or legally authorised adult must manage the Paystack account, business/identity checks, payment settings and live credentials. Confirm with Paystack that the merchant account is eligible to accept USD and recurring subscriptions. Do not enter false age or business information. Keep the Paystack secret key only in the hosting provider's private environment settings.

## Known limitations
This starter verifies payments on the server and enables the browser session after a verified checkout. The lesson text is still included in the public frontend, so this is not yet a secure commercial-grade content paywall. The session is browser-specific rather than a full email/password account system.