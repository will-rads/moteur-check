# QA — Moteur Check, 17 Sept 2026

## Tested

- `npm run verify`: 5 tests pass (real August bill exact verdict 15,387,951 / 4,162,049 LL, 27.04745%, $46.40; July remote 10A/15A; synthetic month with different fees; zero kWh, 7A/12A rejection, no message when not over; Arabic digits and discrepancy warnings). Production build passes.
- Real bill through the browser (dev server, Chromium in the desktop app pane): photo read returned period 2026-08-01 to 2026-09-01, 311 kWh, 60,000, 890,000, 5 A, 19,550,000, area "مار الياس". No hardcoded OCR.
- Live grounded lookup for 2026-08: `live-matched` in 10 to 14 s, real grounding sources (annahar, lbcgroup, lorientlejour, dailybeirut and others), six search queries. September 2026: `unavailable` with an honest reason (not published yet). No fabricated tariff.
- Verdict screen: "That's not maintenance. That's a second salary." Lines +24.4%, +131.2%, +27.0%. Polite and cheeky messages in English and Arabic contain the exact numbers and the Annahar source link. WhatsApp link is user-initiated.
- Deployed API on https://moteur-check.vercel.app: `/api/read` with the bill (2.9 s) and `/api/tariff` for 2026-08 (13.6 s, live-matched) with matching Origin header. Cross-origin POST returns 403, GET returns 405. CSP, X-Frame-Options and Permissions-Policy headers present.
- Phone viewport (375 px): no horizontal overflow, buttons 52 px tall, body text 17 px, smallest text 13 px.

## Not tested (report honestly)

- Real phone camera capture and gallery picker on iOS/Android, picker cancellation on device, and the home-screen install prompt. The file inputs use `capture="environment"` and `accept` per MDN; behaviour varies by browser.
- HEIC or PDF uploads are rejected with a message, not converted.
- Timeouts and quota errors were exercised only through code paths (bounded `AbortSignal.timeout`, 429 mapping), not by forcing Gemini to fail.
- Blurred-photo extraction quality. The edit step exists as the safety net.

## Keys and privacy

- `GEMINI_API_KEY` lives in `.env.local` (git-ignored) and in the Vercel production environment. Never printed.
- `test-bills/` is git-ignored and vercel-ignored. The raw bill is not in the repo or deployment.
- Handlers never log bodies or images; the only server log is the network failure class on a failed Gemini fetch.
