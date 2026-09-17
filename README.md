# Moteur Check

Is your moteur guy overcharging you? Snap a photo of your Lebanese private generator bill.
Gemini reads the numbers, a live grounded search finds the Ministry of Energy and Water's
published tariff for that billing month, the comparison runs in code, and you get a verdict
plus a polite or cheeky message (English and Lebanese Arabic) ready to send.

Live: https://moteur-check.vercel.app (works as a phone app: open it on your phone and add it to the home screen).

## Flow

1. Pick the area category (city or village zone), then take or upload a photo.
2. The photo is shrunk in the browser and sent to `/api/read` (Gemini 2.5 Flash vision, structured JSON). Fields are editable.
3. `/api/tariff` runs a real Google-grounded search for that month's tariff, then structures the sourced text into JSON. Statuses: `live-matched`, `live-sourced`, `saved-reference`, `conflict`, `unavailable`. July and August 2026 are kept as checked references; a cached result is never shown as a fresh search.
4. Verdict: headline, three lines (per kWh, fixed fee, total), difference in LL and USD, sources, and the message with Copy and WhatsApp share.

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
- `src/App.jsx`, `src/styles.css` — the one-page app shell (phone frame on wide screens).
- `tests/tariff.test.mjs` — the acceptance math, including the real August bill.

See `QA.md` for what was tested and what was not.

## Credits

3D images (icons and the receipt mascot) generated with GPT Image 2.5 Flare via Higgsfield. Tariff lookup and bill reading by Gemini 3.8 Flash.
