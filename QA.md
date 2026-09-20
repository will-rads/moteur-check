# QA — Moteur Check, 17 Sept 2026

## Final result dropdowns, 20 September 2026

- Result dropdowns are ordered: Your bill breakdown; Preview or customise your message; Sources and provenance. Edit bill was removed. The red 14px complaint button, bracketed hotline, WhatsApp action, and existing design are retained.
- `npm run verify` passes (five tests and build). Both English and Arabic fit at 390x844; all three disclosures open and close, source links remain available, and Edit bill is absent. Controlled responses were used for layout checks; fresh production lookup and screenshots follow deployment.

## Contact actions update, 20 September 2026 (local, awaiting approval)

- Bill results now show WhatsApp and the Consumer Protection call link immediately below the amount. Message preview, tone, language, and Copy are inside a native disclosure, shared with the Message tab. Existing calculation and message eligibility rules are unchanged.
- Five calculation tests and production build pass. English and Arabic results fit at 390x844 with zero page scroll. Also checked 375x667, 320x640, and 1440x900: no horizontal overflow; smaller layouts scroll inside the app.
- Verified polite defaults in the app language, tone/language changes in the WhatsApp URL, clipboard text (allowing Windows line endings), `tel:1739`, Message tab, and absent complaint actions for clean/conflicting/unavailable comparisons. No runtime errors; no messages or calls made.
- New review screenshots: `../docs/linkedin-launch/moteur-check-actions-en.png` and `moteur-check-actions-ar.png`, each 1170x2532. Both re-render the previously checked August bill and saved tariff using intercepted API responses, not a new live lookup. No raw bill or personal identifiers appear.
- Follow-up: restored Fable's red complaint button with its original 14px white text and bracketed number, restored white WhatsApp text, and removed the result eyebrow/New check row. Build passes; both 390x844 captures fit without scroll; Home > New check resets correctly. Latest captures: `moteur-check-actions-red-en.png` and `moteur-check-actions-red-ar.png`. Previous screenshots retained pending user approval. No push or deployment.

## Navigation update, 20 September 2026 (local)

- Added persistent Home, Bill, Message, and About navigation. Home preserves the current bill; New check clears it; editing invalidates the old verdict and message until a new comparison completes. Meter readings, zone changes, detailed charge comparisons, sources, and hotline information use expandable sections.
- Existing five calculation tests and production build pass. Browser checks passed at 390x844, 375x667, 320x640, and 1440x900, plus Arabic RTL at 390x844. No horizontal page overflow or bottom-nav overlap. Home, review, result, and message fit without page scrolling at 390x844; smaller screens and expanded detail sections scroll within the app.
- Exercised empty tabs, missing-zone prompt, home/resume, all three charge breakdown views, tone switching, sources, editing, new check, unsupported PDF, and conflict/unavailable tariff states. Conflict/unavailable states show no numeric verdict or complaint message. No browser runtime errors. Simulated responses were used for these controlled state checks.
- Separately ran the real August bill through the local preview API: 311 kWh, 19,550,000 LL charged, 15,387,951 LL calculated, difference 4,162,049 LL / $46.40 / 27.04745%. This run returned `saved-reference` because the live response's figures were not tied to retrieved sources; the UI disclosed the fallback. Clipboard contents and WhatsApp draft URL contained the correct amount. No message sent.
- Public-safe home and result screenshots are kept in `../docs/linkedin-launch/`. The result screenshot is a real local run and contains no raw bill image or personal identifiers. UI changes have not been deployed in this task.
- Real device camera, OS keyboard, installation, VoiceOver/TalkBack, and App Store packaging/review remain untested. This remains a web app with a home-screen manifest.

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
