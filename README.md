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

[Moteur Index](https://moteurindex.com) is a public crowd-reported index of what people
across Lebanon pay for generator electricity. After a check, the user can offer their
bill's figures to it — opt-in, no photo, no name, no phone number.

Set `MOTEUR_INDEX_KEY` to switch it on. Without it the panel is inert and everything
else works unchanged.

What is sent, and what is deliberately not:

- **Sent:** district, town, the per-kWh price or monthly fee in USD, the month, the meter
  readings and the unit price. The readings and price go along so the index can check the
  bill's arithmetic closes and catch an OCR misread before a human reviews it.
- **Not sent:** the photo, any name, any phone number, any identifier — and not our
  overcharge percentage either. The index recomputes the comparison from the raw figures
  against its own confirmed ceiling, so every number it publishes comes from one
  methodology rather than two.

Nothing published itself: every contribution waits for a person at Moteur Index to review
it. The app says so rather than claiming the bill is on the map.

One methodology rule is worth knowing if you touch `lib/contribute.mjs`: a fixed monthly
fee *alongside* a per-kWh rate is a standing charge, not a subscription. It is recorded in
the note and never folded into either price axis. Converting a subscription into a per-kWh
figure assumes a household draws its full breaker limit every hour, which understated
Beirut's prices by 2.4x in an earlier version of the index.

## Credits

3D images (icons and the receipt mascot) generated with GPT Image 2.5 Flare via Higgsfield. Tariff lookup and bill reading by Gemini 3.8 Flash.
