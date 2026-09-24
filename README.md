# Moteur Check

Is your moteur guy overcharging you? Snap a photo of your Lebanese private generator bill.
Gemini reads the numbers, a live grounded search finds the Ministry of Energy and Water's
published tariff for that billing month, the comparison runs in code, and you get a verdict
plus a polite or cheeky message (English and Lebanese Arabic) ready to send.

Live: https://moteur-check.vercel.app (works as a phone app: open it on your phone and add it to the home screen).

## Flow

1. Pick the area category (city or village zone), then take or upload a photo.
2. The photo is shrunk in the browser and sent to `/api/read` (Gemini 3.8 Flash vision, structured JSON). Fields are editable.
3. `/api/tariff` runs a real Google-grounded search for that month's tariff, then structures the sourced text into JSON. Statuses: `live-matched`, `live-sourced`, `saved-reference`, `conflict`, `unavailable`. July and August 2026 are kept as checked references; a cached result is never shown as a fresh search.
4. Verdict: headline and difference in LL and USD, with WhatsApp and Consumer Protection call actions up front when the comparison supports a complaint. Three dropdowns follow: bill breakdown; message preview, tone, language and Copy; sources and provenance.

No accounts, no database, no bill storage. The API never logs bill data.

## Run locally

```bash
npm install
cp .env.example .env.local   # add GEMINI_API_KEY
npm run dev                  # http://127.0.0.1:5188
npm run verify               # tests + production build
```

Behind an HTTPS-inspecting antivirus, run Node with `--use-system-ca`.

## Files

- `lib/tariff.mjs` — saved references, validation, the comparison math, headlines, messages.
- `lib/http.mjs` — shared request helpers (POST only, same-origin, byte-counted bodies, per-instance limiter, bounded Gemini calls).
- `api/read.js` — bill photo to structured fields.
- `api/tariff.js` — grounded search + structuring + reference check.
- `src/App.jsx`, `src/styles.css` — the app shell with persistent Home, Bill, Message, and About navigation (phone frame on wide screens). Home keeps the current check; New check clears it. Bill review, charge breakdown, and source details expand only when needed.
- `lib/contribute.mjs` — turns a checked bill into a Moteur Index report (pure; no network).
- `api/contribute.js` — forwards it, holding the partner key server-side.
- `tests/tariff.test.mjs` — the acceptance math, including the real August bill.
- `tests/contribute.test.mjs` — the Moteur Index mapping, against the same real bill.

See `QA.md` for what was tested and what was not.

## Submission (ZAKA FUN Challenge 2026)

- Live app: https://moteur-check.vercel.app · Repo: https://github.com/will-rads/moteur-check
- Vercel project `moteur-check-fable` under the personal `will-namou` scope (the old `moteur-check-fable.vercel.app` alias still works).
- Description used on the form:

> Every month in Lebanon, millions of people pay a private generator bill for the "moteur." Every month, many of them get overcharged. Nobody checks, because nobody knows the official price. Moteur Check fixes that in ten seconds. Snap a photo of your bill. The app reads the numbers, searches the web live for the Ministry of Energy's tariff for that exact month, and shows you the difference in Lebanese pounds and dollars. Red stamp if you're paying too much. Then comes the fun part. It writes the message to your moteur guy for you. Pick "polite" or "cheeky," in English or Lebanese Arabic, and send it straight to WhatsApp. Still no fix? One tap calls the Consumer Protection hotline. No accounts. No stored bills. Just the truth about your electricity bill, and a way to do something about it.

## Contributing bills to Moteur Index

Set the server-only `MOTEUR_INDEX_KEY` issued by Moteur Index and redeploy to enable
sharing. `GET /api/contribute` returns only `{ enabled: boolean }`; without a key the
panel stays hidden. `MOTEUR_INDEX_PARTNER` defaults to `moteur-check`. The same API
handlers run locally through Vite.

After the verdict, users choose a district and optional town, preview every outgoing
field, and explicitly consent. Editing the location resets consent. Submissions go to
Moteur Index for storage, moderation and possible publication, never directly onto the map.
The photo, customer details, dollar total, grand total and our verdict are not sent.

Only metered bills are supported. A missing unit price is an error, never a flat
subscription. Meter readings must agree with consumption when present. Standing charges
stay in the note, separate from the per-kWh price. USD conversion uses the confirmed
billing month's tariff exchange rate, which is shown in the preview, never hidden OCR.

We send meter readings, consumption and the LL unit price. `energy_total` is deliberately
omitted because the reader does not extract an independent energy subtotal. Deriving it
from kWh times price would falsely appear to verify OCR. VAT stays unknown. The UI makes
no claim of full reconciliation; only HTTP 202 from the partner API confirms queued status.

Run `npm run verify` for regression checks and a production build. Tests mock the partner
API and do not create public reports. The original tariff lookup remains unchanged; the
Index tariff API is not a replacement for the app's month-specific rates and fixed fees.

## Credits

3D images (icons and the receipt mascot) generated with GPT Image 2.5 Flare via Higgsfield. Tariff lookup and bill reading by Gemini 3.8 Flash.
