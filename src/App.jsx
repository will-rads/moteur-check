import { useEffect, useRef, useState } from "react";
import { HEADLINES, ZONES, buildMessages, compare, formatLL, formatUSD, monthLabel, normalizeBill, verdictKey } from "../lib/tariff.mjs";

const STATUS_LABEL = {
  "live-matched": "Found live. Matches the saved reference.",
  "live-sourced": "Found by search. Confirm with the published announcement.",
  "saved-reference": (m) => `Live lookup unavailable. Using the saved ${m} reference.`,
  conflict: "Sources disagree. Verdict withheld.",
  unavailable: "Tariff could not be confirmed.",
};
const CONFIRMED = ["live-matched", "live-sourced", "saved-reference"];
const EMPTY = { periodStart: "", periodEnd: "", kwh: "", rateLL: "", fixedLL: "", amps: "", totalLL: "", previousReading: "", currentReading: "", areaHint: "" };

async function shrink(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file could not be opened as a photo. Use a JPEG, PNG or WebP.");
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("The photo could not be prepared. Please try another one.");
  return blob;
}

const num = (v) => (v === null || v === undefined ? "" : String(v));
const monthOf = (iso) => (typeof iso === "string" && /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : "");

function ZonePicker({ name, zone, onPick, legend }) {
  return (
    <fieldset className="zones">
      <legend>{legend}</legend>
      {Object.entries(ZONES).map(([key, text]) => (
        <label key={key} className={`zone ${zone === key ? "on" : ""}`}>
          <input type="radio" name={name} value={key} checked={zone === key} onChange={() => onPick(key)} />
          <span className="zone-title">{key === "cities" ? "City" : "Village"}</span>
          <span className="zone-desc">{text}</span>
        </label>
      ))}
    </fieldset>
  );
}

export default function App() {
  const [step, setStep] = useState("upload");
  const [zone, setZone] = useState("");
  const [zoneNudge, setZoneNudge] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");
  const [fields, setFields] = useState(EMPTY);
  const [month, setMonth] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [lookup, setLookup] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const screenRef = useRef(null);
  const zoneRef = useRef(null);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  useEffect(() => () => photoUrl && URL.revokeObjectURL(photoUrl), [photoUrl]);
  const toTop = () => screenRef.current?.scrollTo({ top: 0 });

  function reset() {
    setStep("upload");
    setFields(EMPTY);
    setMonth("");
    setError("");
    setWarnings([]);
    setLookup(null);
    setOutcome(null);
    setPhotoUrl("");
    toTop();
  }

  function pick(ref) {
    if (!zone) {
      setZoneNudge(true);
      zoneRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      zoneRef.current?.querySelector("input")?.focus();
      return;
    }
    setZoneNudge(false);
    ref.current?.click();
  }

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return; // picker cancelled
    setError("");
    setStep("reading");
    toTop();
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPEG, PNG or WebP photo. HEIC and PDF are not supported yet.");
      setPhotoUrl(URL.createObjectURL(file));
      const blob = await shrink(file);
      if (blob.size > 4 * 1024 * 1024) throw new Error("The photo is too large even after shrinking. Try a smaller one.");
      const res = await fetch("/api/read", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Reading the photo failed. Please try again.");
      setFields({
        periodStart: num(data.periodStart),
        periodEnd: num(data.periodEnd),
        kwh: num(data.kwhConsumed),
        rateLL: num(data.pricePerKwhLL),
        fixedLL: num(data.fixedFeeLL),
        amps: num(data.amps),
        totalLL: num(data.totalLL),
        previousReading: num(data.previousReading),
        currentReading: num(data.currentReading),
        areaHint: num(data.areaHint),
      });
      setMonth(monthOf(data.periodStart));
      setStep("review");
    } catch (e) {
      setError(e.message);
      setStep("upload");
    }
  }

  function periodProblem() {
    const a = Date.parse(fields.periodStart);
    const b = Date.parse(fields.periodEnd);
    if (Number.isFinite(a) && Number.isFinite(b) && b - a > 40 * 86400000) return "This bill covers more than one month. Moteur Check compares one month at a time.";
    return "";
  }

  async function confirm(event) {
    event.preventDefault();
    setError("");
    let normalized;
    try {
      normalized = normalizeBill(fields);
    } catch (e) {
      return setError(e.message);
    }
    const multi = periodProblem();
    if (multi) return setError(multi);
    if (!/^\d{4}-\d{2}$/.test(month)) return setError("Pick the bill's month and year.");
    if (!zone) return setError("Confirm the area category first.");
    setWarnings(normalized.warnings);
    setStep("searching");
    toTop();
    let data;
    try {
      const res = await fetch("/api/tariff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, zone }) });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The tariff lookup failed. Please try again.");
    } catch (e) {
      setError(e.message);
      return setStep("review");
    }
    setLookup(data);
    if (data.tariff) {
      try {
        const result = compare({ bill: normalized.bill, zone, tariff: data.tariff, displayRateLL: data.tariff.exchangeRateLL || null });
        setOutcome({ result, bill: normalized.bill, key: verdictKey(result, data.status) });
      } catch (e) {
        setError(e.message);
        return setStep("review");
      }
    } else setOutcome({ result: null, bill: normalized.bill, key: "unconfirmed" });
    setStep("verdict");
    toTop();
  }

  const label = month && /^\d{4}-\d{2}$/.test(month) ? monthLabel(month) : "";

  return (
    <div className="stage">
      <div className="device">
        <div className="screen" ref={screenRef}>
          <header className="appbar">
            <a className="brand" href="/" onClick={(e) => { e.preventDefault(); reset(); }}>
              <span className="brand-mark" aria-hidden="true">⚡</span> Moteur Check
            </a>
          </header>

          {step === "upload" && (
            <>
              <section className="home enter">
                <img className="home-icon float" src="/icon-moteur.png" alt="" width="170" height="170" />
                <h1>Is your moteur guy overcharging you?</h1>
                <p className="lede">Snap the bill. We find the Ministry's tariff for that month, show the difference, and write the message.</p>
                <div ref={zoneRef} className={zoneNudge ? "nudge" : ""}>
                  <ZonePicker name="zone" zone={zone} legend="Where is the generator?" onPick={(k) => { setZone(k); setZoneNudge(false); }} />
                  {zoneNudge && <p className="nudge-text" role="alert">Pick your area first. The tariff has two zones.</p>}
                </div>
                {error && <p className="error" role="alert">{error}</p>}
                <p className="privacy">Processed by Gemini. This app does not save your bill.</p>
              </section>
              <div className="bar">
                <button type="button" className="btn primary" onClick={() => pick(cameraRef)}>Take a photo</button>
                <button type="button" className="btn" onClick={() => pick(galleryRef)}>Upload photo</button>
              </div>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
              <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile} />
            </>
          )}

          {step === "reading" && (
            <section className="wait enter" aria-live="polite">
              <div className="scan">
                {photoUrl ? <img src={photoUrl} alt="Your bill" /> : <img className="wait-icon" src="/icon-bill.png" alt="" width="160" height="160" />}
                <span className="scan-line" aria-hidden="true" />
              </div>
              <h2>Reading your bill…</h2>
              <p className="muted">Gemini is picking out the numbers. A few seconds.</p>
            </section>
          )}

          {step === "review" && (
            <>
              <form className="review enter" onSubmit={confirm} id="review">
                <div className="review-head">
                  {photoUrl && <img className="thumb" src={photoUrl} alt="Your bill" />}
                  <div>
                    <h2>Does this look right?</h2>
                    <p className="muted">Fix anything the photo got wrong.{fields.areaHint && <> Bill says: <strong>{fields.areaHint}</strong>.</>}</p>
                  </div>
                </div>
                <div className="grid">
                  <Field label="Billing month" type="month" value={month} onChange={setMonth} required />
                  <Field label="kWh consumed" value={fields.kwh} onChange={(v) => setFields({ ...fields, kwh: v })} required />
                  <Field label="Price per kWh (LL)" value={fields.rateLL} onChange={(v) => setFields({ ...fields, rateLL: v })} />
                  <Field label="Fixed fee (LL)" value={fields.fixedLL} onChange={(v) => setFields({ ...fields, fixedLL: v })} />
                  <Field label="Amps" value={fields.amps} onChange={(v) => setFields({ ...fields, amps: v })} />
                  <Field label="Total on the bill (LL)" value={fields.totalLL} onChange={(v) => setFields({ ...fields, totalLL: v })} />
                  <Field label="Previous reading" value={fields.previousReading} onChange={(v) => setFields({ ...fields, previousReading: v })} />
                  <Field label="Current reading" value={fields.currentReading} onChange={(v) => setFields({ ...fields, currentReading: v })} />
                </div>
                <ZonePicker name="zone2" zone={zone} legend="Area category" onPick={setZone} />
                {error && <p className="error" role="alert">{error}</p>}
              </form>
              <div className="bar">
                <button type="submit" form="review" className="btn primary">Looks right</button>
              </div>
            </>
          )}

          {step === "searching" && (
            <section className="wait enter" aria-live="polite">
              <img className="wait-icon pulse" src="/icon-bill.png" alt="" width="160" height="160" />
              <h2>Searching the tariff for {label}…</h2>
              <p className="muted">Live search for the Ministry of Energy and Water's announcement. Usually 10 to 20 seconds.</p>
            </section>
          )}

          {step === "verdict" && lookup && outcome && (
            <Verdict lookup={lookup} outcome={outcome} month={month} zone={zone} warnings={warnings} onRetry={() => setStep("review")} onReset={reset} />
          )}

          <footer className="foot">
            <p>Based on the Ministry of Energy and Water's published tariff. Confirm with the official decree.</p>
            <p>No accounts. No bill storage. Built for the ZAKA FUN Challenge 2026.</p>
          </footer>
        </div>
      </div>
      <aside className="stage-note">
        <img src="/app-icon.png" alt="" width="56" height="56" />
        <div>
          <strong>Moteur Check is a phone app.</strong>
          <p>Open this link on your phone and add it to your home screen. Take a photo of the bill, get the verdict, send the message.</p>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} inputMode={type === "text" ? "decimal" : undefined} value={value} required={required} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Row({ name, line, comment, rate }) {
  const usd = (v) => (v === null || !rate ? null : <i>{formatUSD(v / rate)}</i>);
  const over = line.diff !== null && Math.round(line.diff) > 0;
  const under = line.diff !== null && Math.round(line.diff) < 0;
  return (
    <div className="row">
      <div className="row-head">
        <strong>{name}</strong>
        {comment && <span className="row-joke">{comment}</span>}
      </div>
      <div className="cells">
        <div><small>Charged</small><b>{formatLL(line.charged)}</b>{usd(line.charged)}</div>
        <div><small>Ministry</small><b>{formatLL(line.official)}</b>{usd(line.official)}</div>
        <div className={over ? "over" : under ? "under" : ""}>
          <small>Difference</small>
          <b>{line.diff === null ? "—" : `${over ? "+" : ""}${formatLL(line.diff)}`}</b>
          {usd(line.diff)}
          {line.pct !== null && Math.round(line.diff) !== 0 && <em>{line.pct > 0 ? "+" : ""}{line.pct.toFixed(1)}%</em>}
        </div>
      </div>
    </div>
  );
}

function Verdict({ lookup, outcome, month, zone, warnings, onRetry, onReset }) {
  const [cheeky, setCheeky] = useState(false);
  const [lang, setLang] = useState("en");
  const [copied, setCopied] = useState(false);
  const { result, bill, key } = outcome;
  const label = monthLabel(month);
  const status = lookup.status;
  const confirmed = CONFIRMED.includes(status);
  const statusText = typeof STATUS_LABEL[status] === "function" ? STATUS_LABEL[status](label) : STATUS_LABEL[status];
  const sources = (lookup.sources?.length ? lookup.sources : lookup.savedSources) || [];
  const sourceUri = lookup.savedSources?.[0]?.uri || sources[0]?.uri || "";
  const messages = result && confirmed ? buildMessages({ result, bill, month, tariff: lookup.tariff, sourceUri, cheeky }) : null;
  const text = messages ? messages[lang] : "";
  const pct = result?.overchargePct;

  const jokes = result && {
    rate: result.lines.rate.diff > 0 ? "Same kilowatt-hour. Apparently a premium edition." : null,
    fixed: result.lines.fixed.diff > 0 ? `The published fee is ${formatLL(result.lines.fixed.official)} for ${bill.amps} amps. Yours says ${formatLL(result.lines.fixed.charged)}. Is the generator getting a spa day?` : null,
  };
  const bothMatch = result && result.lines.rate.diff === 0 && result.lines.fixed.diff === 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.getElementById("msg");
      ta?.focus();
      ta?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="verdict enter">
      <div className="headline-row">
        <h1 className="headline">{HEADLINES[key]}</h1>
        <img className="mascot" src="/receipt-mascot.png" alt="" width="96" height="96" />
      </div>
      <p className={`status ${confirmed ? "ok" : "warn"}`}>{label} · {zone === "cities" ? "City" : "Village"} · {statusText}</p>

      {result && confirmed && (
        <div className="big">
          {result.overchargeLL !== null ? (
            <>
              <span className="big-label">{result.overchargeLL >= 0 ? "Above the published calculation" : "Below the published calculation"}</span>
              <span className="big-ll">{formatLL(Math.abs(result.overchargeLL))} <small>LL</small></span>
              {result.overchargeUSD !== null && <span className="big-usd">about {formatUSD(result.overchargeUSD)} at {formatLL(result.displayRateLL)} LL/$</span>}
              {pct !== null && Math.round(result.overchargeLL) !== 0 && <span className="stamp">{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</span>}
            </>
          ) : (
            <span className="big-label">Add the amps or the bill total to compare the full bill.</span>
          )}
        </div>
      )}

      {result && confirmed && (
        <div className="table">
          <Row name="Per kWh" line={result.lines.rate} comment={jokes.rate} rate={result.displayRateLL} />
          <Row name={`Fixed fee${bill.amps ? `, ${bill.amps} A` : ""}`} line={result.lines.fixed} comment={jokes.fixed} rate={result.displayRateLL} />
          <Row name={`Total for ${formatLL(bill.kwh)} kWh`} line={result.lines.total} comment={bothMatch ? "Both lines match the published tariff. Someone read the newspaper." : null} rate={result.displayRateLL} />
        </div>
      )}

      {status === "conflict" && (
        <div className="note warn">
          <p>{lookup.reason}</p>
          <p>Live: {formatLL(lookup.liveTariff?.perKwhCitiesLL)} / {formatLL(lookup.liveTariff?.perKwhRemoteLL)} LL per kWh, fixed {formatLL(lookup.liveTariff?.fixed5LL)} (5 A). Saved: {formatLL(lookup.savedTariff?.perKwhCitiesLL)} / {formatLL(lookup.savedTariff?.perKwhRemoteLL)}, fixed {formatLL(lookup.savedTariff?.fixed5LL)}.</p>
        </div>
      )}
      {status === "unavailable" && (
        <div className="note warn">
          <p>{lookup.reason || "No confirmed tariff for this month yet."}</p>
          <button type="button" className="btn" onClick={onRetry}>Retry the lookup</button>
        </div>
      )}

      {warnings.map((w) => <p key={w} className="note">{w}</p>)}

      {messages ? (
        <div className="message">
          <div className="message-head">
            <img src="/icon-message.png" alt="" width="64" height="64" />
            <div>
              <h2>Message for your moteur guy</h2>
              <p className="muted">Friendly enough to actually send.</p>
            </div>
          </div>
          <div className="toggles">
            <div className="seg" role="group" aria-label="Tone">
              <button type="button" className={!cheeky ? "on" : ""} onClick={() => setCheeky(false)}>Polite</button>
              <button type="button" className={cheeky ? "on" : ""} onClick={() => setCheeky(true)}>Cheeky</button>
            </div>
            <div className="seg" role="group" aria-label="Language">
              <button type="button" className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>English</button>
              <button type="button" className={lang === "ar" ? "on" : ""} onClick={() => setLang("ar")}>عربي</button>
            </div>
          </div>
          <textarea id="msg" className="msg" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} readOnly value={text} rows={7} />
          <div className="actions">
            <button type="button" className="btn primary" onClick={copy}>{copied ? "Copied" : "Copy message"}</button>
            <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Open in WhatsApp</a>
          </div>
          <div className="escalate">
            <p><strong>No fix?</strong> Generator overbilling can be reported to the Ministry of Economy's Consumer Protection hotline.</p>
            <a className="btn" href="tel:1739">Call Consumer Protection (1739)</a>
          </div>
        </div>
      ) : (
        result && confirmed && <p className="note">No complaint needed for this bill. Keep the check handy for next month.</p>
      )}

      <details className="sources">
        <summary>Sources and provenance</summary>
        <p className="muted">Searched {lookup.searchedAt ? new Date(lookup.searchedAt).toLocaleString() : "now"}{lookup.referenceCheckedAt && ` · saved reference checked ${lookup.referenceCheckedAt}`}{lookup.tariff?.publicationDate && ` · tariff published ${lookup.tariff.publicationDate}`}</p>
        {lookup.tariff && (
          <p className="muted mono">
            {formatLL(lookup.tariff.perKwhCitiesLL)} LL/kWh city · {formatLL(lookup.tariff.perKwhRemoteLL)} LL/kWh village · fixed {formatLL(lookup.tariff.fixed5LL)} (5 A) / {formatLL(lookup.tariff.fixed10LL)} (10 A) / +{formatLL(lookup.tariff.extra5LL)} per extra 5 A
          </p>
        )}
        <ul>
          {sources.slice(0, 8).map((s) => (
            <li key={s.uri}><a href={s.uri} target="_blank" rel="noopener noreferrer">{s.title}</a></li>
          ))}
        </ul>
        {lookup.searchQueries?.length > 0 && <p className="muted">Search queries: {lookup.searchQueries.join(" · ")}</p>}
        <p className="muted">Based on the Ministry of Energy and Water's published tariff. Confirm with the official decree.</p>
      </details>

      <div className="actions end">
        <button type="button" className="btn primary" onClick={onReset}>Check another bill</button>
      </div>
    </section>
  );
}
