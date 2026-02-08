# Wallet Memo — Cloudflare Worker Backend

Cloudflare Worker replacement for the Express/Railway backend. Generates Apple Wallet .pkpass files for Wallet Memo.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create KV namespace
```bash
npx wrangler kv namespace create PENDING_PASSES
```
Copy the output `id` into `wrangler.toml` replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

### 3. Set secrets
```bash
npx wrangler secret put P12_BASE64      # Base64 of your pass.p12 certificate
npx wrangler secret put P12_PASSWORD     # Password for the .p12 file
npx wrangler secret put WWDR_PEM         # Apple WWDR certificate (full PEM text)
```

### 4. Configure custom domain (optional)
Add to `wrangler.toml`:
```toml
routes = [
  { pattern = "wallet-api.britonbaker.com/*", zone_name = "britonbaker.com" }
]
```
Or use `workers.dev` subdomain by default.

### 5. Deploy
```bash
npm run deploy
```

### 6. Local dev
```bash
npm run dev
```
Note: You'll need a `.dev.vars` file for local secrets:
```
P12_BASE64=...
P12_PASSWORD=...
WWDR_PEM=-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/generate-pass` | Generate .pkpass (body: `{text, color, drawingDataUrl}`) |
| POST | `/api/prepare-pass` | Safari iOS step 1 — returns `{token}` |
| GET | `/api/download-pass/:token` | Safari iOS step 2 — downloads .pkpass |
| GET | `/api/pass-redirect?t=BASE64&c=COLOR` | QR code redirect → .pkpass |
| GET | `/test-pass?text=Hello&color=pink` | Quick test |

## Frontend update needed

In `sandbox/index.html` line ~1699, change:
```js
const BACKEND_URL = 'https://sandbox-staging.up.railway.app';
```
to:
```js
const BACKEND_URL = 'https://wallet-api.britonbaker.com';
```
(or whatever your worker URL ends up being)

## Limitations vs original Express backend

1. **No text on strip image** — The strip is a solid color rectangle only. Text rendering required canvas/font support which isn't available in Workers. The memo text still appears in the pass's `secondaryFields` so it's visible on the pass.

2. **No drawing overlay on strip** — User drawings (`drawingDataUrl`) are not composited onto the strip image. Would require WASM canvas support to implement.

3. **No logo image** — The original generated a logo.png dynamically. This version relies on `logoText` in pass.json instead (which Apple renders natively).

4. **Icon is simplified** — The icon is a colored rounded square with lines, but rendered with simple pixel math instead of anti-aliased canvas drawing. Looks slightly rougher at small sizes.

These are cosmetic differences only — the pass functionality (text, colors, wallet integration) is identical.
