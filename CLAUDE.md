# CLAUDE.md — Wallet Worker (Backend)

## What This Is

Cloudflare Worker that generates signed Apple Wallet `.pkpass` files for Wallet Memo.

- **Live:** https://wallet-api.britonbaker.com
- **Workers.dev:** https://wallet-worker.38briton.workers.dev
- **Frontend:** https://walletmemo.com (separate repo: `britonbaker/sandbox`)

## Tech

- Cloudflare Worker (ES modules)
- **node-forge 1.3.3** for PKCS7 signing — **do not upgrade**, newer versions break on CF Workers
- KV namespace `PENDING_PASSES` for token-based download flow

## Source Files

```
src/
  index.js          # Router, CORS, endpoint handlers
  pass-builder.js   # .pkpass ZIP assembly + PKCS7 signing
  image-gen.js      # Strip/icon PNG generation
wrangler.toml       # Worker config
```

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/pass-redirect` | POST | Mobile: build pass, redirect to download |
| `/api/prepare-pass` | POST | Desktop: build pass, store with token |
| `/api/download-pass/:token` | GET | Desktop: retrieve stored pass |
| `/api/test-pass` | GET | Quick test (`?text=hello&color=yellow`) |
| `/api/instant-bundle` | POST | Direct pass download (no redirect) |

## Certificates

- **Pass type:** `pass.com.walletmemo.note`
- **Team ID:** `HTWS8J5HF3`
- **WWDR G4 cert:** valid until 2030
- **Signer cert:** valid until Feb 2027
- Stored as Cloudflare secrets: `P12_BASE64`, `P12_PASSWORD`, `WWDR_PEM`

## Deploy

```bash
npx wrangler deploy   # from master branch
```

## ⚠️ CRITICAL: Always Test After Deploy

```
https://wallet-api.britonbaker.com/test-pass?text=hello&color=yellow
```

Download the pass. Open it. Verify it works. Every time.

## Rollback

```bash
npx wrangler rollback                  # undo last deploy
npx wrangler deployments list          # see all deploys
```

## Git Config

- **User:** clawdbrit
- **Branch:** `master`
- **Push:** `git push origin master`
