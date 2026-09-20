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
- `tests/tariff.test.mjs` — the acceptance math, including the real August bill.

See `QA.md` for what was tested and what was not.

## Submission (ZAKA FUN Challenge 2026)

- Live app: https://moteur-check.vercel.app · Repo: https://github.com/will-rads/moteur-check
- Vercel project `moteur-check-fable` under the personal `will-namou` scope (the old `moteur-check-fable.vercel.app` alias still works).
- Description used on the form:

> Every month in Lebanon, millions of people pay a private generator bill for the "moteur." Every month, many of them get overcharged. Nobody checks, because nobody knows the official price. Moteur Check fixes that in ten seconds. Snap a photo of your bill. The app reads the numbers, searches the web live for the Ministry of Energy's tariff for that exact month, and shows you the difference in Lebanese pounds and dollars. Red stamp if you're paying too much. Then comes the fun part. It writes the message to your moteur guy for you. Pick "polite" or "cheeky," in English or Lebanese Arabic, and send it straight to WhatsApp. Still no fix? One tap calls the Consumer Protection hotline. No accounts. No stored bills. Just the truth about your electricity bill, and a way to do something about it.

## Credits

3D images (icons and the receipt mascot) generated with GPT Image 2.5 Flare via Higgsfield. Tariff lookup and bill reading by Gemini 3.8 Flash.
