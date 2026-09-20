import { useEffect, useRef, useState } from "react";
import { buildMessages, compare, formatLL, formatUSD, monthLabel, normalizeBill, verdictKey } from "../lib/tariff.mjs";
import { T } from "./i18n.js";

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

function LangToggle({ lang, setLang }) {
  return (
    <div className="seg" role="group" aria-label="Language">
      <button type="button" className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
      <button type="button" className={lang === "ar" ? "on" : ""} onClick={() => setLang("ar")}>عربي</button>
    </div>
  );
}

function ZonePicker({ name, zone, onPick, legend, t }) {
  return (
    <fieldset className="zones">
      <legend>{legend}</legend>
      {[["cities", t.city, t.cityDesc], ["remote", t.village, t.villageDesc]].map(([key, title, desc]) => (
        <label key={key} className={`zone ${zone === key ? "on" : ""}`}>
          <input type="radio" name={name} value={key} checked={zone === key} onChange={() => onPick(key)} />
          <span className="zone-title">{title}</span>
          <span className="zone-desc">{desc}</span>
        </label>
      ))}
    </fieldset>
  );
}

export default function App() {
  const [lang, setLang] = useState("en");
  const t = T[lang];
  const [page, setPage] = useState("home");
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
  const busy = step === "reading" || step === "searching";

  useEffect(() => () => photoUrl && URL.revokeObjectURL(photoUrl), [photoUrl]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const toTop = () => screenRef.current?.scrollTo({ top: 0 });
  useEffect(() => {
    toTop();
    screenRef.current?.focus({ preventScroll: true });
  }, [page, step]);

  function edit() {
    setOutcome(null);
    setLookup(null);
    setPage("bill");
    setStep("review");
  }

  function reset() {
    setPage("home");
    setStep("upload");
    setFields(EMPTY);
    setMonth("");
    setError("");
    setWarnings([]);
    setLookup(null);
    setOutcome(null);
    setPhotoUrl("");
    setZoneNudge(false);
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
    setFields(EMPTY);
    setMonth("");
    setLookup(null);
    setOutcome(null);
    setWarnings([]);
    setError("");
    setPage("bill");
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
      setPage("home");
      setPhotoUrl("");
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

  const label = month && /^\d{4}-\d{2}$/.test(month) ? monthLabel(month, lang) : "";

  return (
    <div className="stage" dir={t.dir}>
      <div className="device">
        <div className="app-shell">
          <header className="appbar">
            <button className="brand" type="button" disabled={busy} onClick={() => setPage("home")}>
              <span className="brand-mark" aria-hidden="true">⚡</span> {t.brand}
            </button>
            <LangToggle lang={lang} setLang={setLang} />
          </header>
          <main className="screen" ref={screenRef} tabIndex={-1} aria-label={t.nav[page]}>

          {page === "home" && (
            <>
              <section className="home enter">
                <img className="home-icon" src="/icon-moteur.png" alt="" width="120" height="120" />
                <h1>{t.h1}</h1>
                <p className="lede">{t.lede}</p>
                {step === "upload" ? <div ref={zoneRef} className={zoneNudge ? "nudge" : ""}>
                  <ZonePicker name="zone" zone={zone} legend={t.zoneLegend} t={t} onPick={(k) => { setZone(k); setZoneNudge(false); }} />
                  {zoneNudge && <p className="nudge-text" role="alert">{t.nudge}</p>}
                </div> : <div className="resume-card"><strong>{t.currentBill}</strong><p>{label}</p><button type="button" className="btn primary" onClick={() => setPage("bill")}>{t.resume}</button><button type="button" className="btn ghost" onClick={reset}>{t.newCheck}</button></div>}
                {error && <p className="error" role="alert">{error}</p>}
                <p className="privacy">{t.privacy}</p>
              </section>
              {step === "upload" && <div className="bar">
                <button type="button" className="btn primary" onClick={() => pick(cameraRef)}>{t.takePhoto}</button>
                <button type="button" className="btn" onClick={() => pick(galleryRef)}>{t.uploadPhoto}</button>
              </div>}
            </>
          )}

          {page === "bill" && step === "upload" && <EmptyState t={t} onStart={() => setPage("home")} />}

          {page === "bill" && step === "reading" && (
            <section className="wait enter" aria-live="polite">
              <div className="scan">
                {photoUrl ? <img src={photoUrl} alt="" /> : <img className="wait-icon" src="/icon-bill.png" alt="" width="160" height="160" />}
                <span className="scan-line" aria-hidden="true" />
              </div>
              <h2>{t.reading}</h2>
              <p className="muted">{t.readingSub}</p>
            </section>
          )}

          {page === "bill" && step === "review" && (
            <>
              <form className="review enter" onSubmit={confirm} id="review">
                <div className="review-head">
                  {photoUrl && <img className="thumb" src={photoUrl} alt="" />}
                  <div>
                    <h1 className="page-title">{t.reviewTitle}</h1>
                    <p className="muted">{t.reviewSub}{fields.areaHint && <> {t.billSays} <strong>{fields.areaHint}</strong>.</>}</p>
                  </div>
                </div>
                <div className="grid">
                  <Field label={t.fMonth} type="month" value={month} onChange={setMonth} required />
                  <Field label={t.fKwh} value={fields.kwh} onChange={(v) => setFields({ ...fields, kwh: v })} required />
                  <Field label={t.fRate} value={fields.rateLL} onChange={(v) => setFields({ ...fields, rateLL: v })} />
                  <Field label={t.fFixed} value={fields.fixedLL} onChange={(v) => setFields({ ...fields, fixedLL: v })} />
                  <Field label={t.fAmps} value={fields.amps} onChange={(v) => setFields({ ...fields, amps: v })} />
                  <Field label={t.fTotal} value={fields.totalLL} onChange={(v) => setFields({ ...fields, totalLL: v })} />
                </div>
                <details className="disclosure">
                  <summary>{t.meterReadings}</summary>
                  <div className="grid">
                    <Field label={t.fPrev} value={fields.previousReading} onChange={(v) => setFields({ ...fields, previousReading: v })} />
                    <Field label={t.fCurr} value={fields.currentReading} onChange={(v) => setFields({ ...fields, currentReading: v })} />
                  </div>
                </details>
                <details className="disclosure">
                  <summary>{t.zoneLegend2}: {zone === "cities" ? t.city : t.village}</summary>
                  <ZonePicker name="zone2" zone={zone} legend={t.zoneLegend2} t={t} onPick={setZone} />
                </details>
                {error && <p className="error" role="alert">{error}</p>}
              </form>
              <div className="bar">
                <button type="submit" form="review" className="btn primary">{t.looksRight}</button>
              </div>
            </>
          )}

          {page === "bill" && step === "searching" && (
            <section className="wait enter" aria-live="polite">
              <img className="wait-icon pulse" src="/icon-bill.png" alt="" width="160" height="160" />
              <h2>{t.searching(label)}</h2>
              <p className="muted">{t.searchingSub}</p>
            </section>
          )}

          {(page === "bill" || page === "message") && step === "verdict" && lookup && outcome && (
            <Verdict t={t} lang={lang} view={page} lookup={lookup} outcome={outcome} month={month} zone={zone} warnings={warnings} onRetry={edit} onNavigate={setPage} />
          )}

          {page === "message" && step !== "verdict" && <EmptyState t={t} onStart={() => setPage(step === "review" ? "bill" : "home")} />}
          {page === "about" && <section className="about enter">
            <h1 className="page-title">{t.aboutTitle}</h1>
            <p>{t.aboutText}</p>
            <p className="note">{t.privacyDetail}</p>
            {lookup && <Sources t={t} lookup={lookup} />}
            <details className="disclosure"><summary>{t.installTitle}</summary><p>{t.installText}</p></details>
            <p className="muted">{t.disclaimer}</p>
            <p className="muted">{t.foot2}</p>
          </section>}
          </main>
          <nav className="bottom-nav" aria-label={t.navigation}>
            {["home", "bill", "message", "about"].map((key) => <button type="button" key={key} className={page === key ? "active" : ""} aria-current={page === key ? "page" : undefined} disabled={busy} onClick={() => setPage(key)}><NavIcon name={key} /><span>{t.nav[key]}</span></button>)}
          </nav>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
          <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile} />
        </div>
      </div>
      <aside className="stage-note">
        <img src="/app-icon.png" alt="" width="56" height="56" />
        <div>
          <strong>{t.stageTitle}</strong>
          <p>{t.stageText}</p>
        </div>
      </aside>
    </div>
  );
}

function NavIcon({ name }) {
  const paths = {
    home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
    bill: "M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6",
    message: "M21 4H3v13h5l4 4v-4h9ZM7 8h10M7 12h7",
    about: "M12 11v6M12 7v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function EmptyState({ t, onStart }) {
  return <section className="empty-state"><img src="/icon-bill.png" width="120" height="120" alt="" /><h1 className="page-title">{t.emptyTitle}</h1><p className="muted">{t.emptyText}</p><button type="button" className="btn primary" onClick={onStart}>{t.startCheck}</button></section>;
}

function Field({ label, value, onChange, type = "text", required }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} inputMode={type === "text" ? "decimal" : undefined} dir="ltr" value={value} required={required} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Row({ name, line, comment, rate, t }) {
  const over = line.diff !== null && Math.round(line.diff) > 0;
  const under = line.diff !== null && Math.round(line.diff) < 0;
  const usd = (v) => (v === null || !rate ? null : <i>{formatUSD(v / rate)}</i>);
  return (
    <div className="row">
      <div className="row-head">
        <strong>{name}</strong>
        {comment && <span className="row-joke">{comment}</span>}
      </div>
      <div className="cells">
        <div><small>{t.charged}</small><b>{formatLL(line.charged)} <u>LL</u></b>{usd(line.charged)}</div>
        <div><small>{t.ministry}</small><b>{formatLL(line.official)} <u>LL</u></b>{usd(line.official)}</div>
        <div className={over ? "over" : under ? "under" : ""}>
          <small>{t.difference}</small>
          <b>{line.diff === null ? "—" : <>{over ? "+" : ""}{formatLL(line.diff)} <u>LL</u></>}</b>
          {usd(line.diff)}
          {line.pct !== null && Math.round(line.diff) !== 0 && <em>{line.pct > 0 ? "+" : ""}{line.pct.toFixed(1)}%</em>}
        </div>
      </div>
    </div>
  );
}

function Verdict({ t, lang, view, lookup, outcome, month, zone, warnings, onRetry, onNavigate }) {
  const [cheeky, setCheeky] = useState(false);
  const [msgLang, setMsgLang] = useState(lang);
  const [copied, setCopied] = useState(false);
  const [breakdown, setBreakdown] = useState("total");
  useEffect(() => setMsgLang(lang), [lang]);
  const { result, bill, key } = outcome;
  const label = monthLabel(month, lang);
  const status = lookup.status;
  const confirmed = CONFIRMED.includes(status);
  const sources = (lookup.sources?.length ? lookup.sources : lookup.savedSources) || [];
  const sourceUri = lookup.savedSources?.[0]?.uri || sources[0]?.uri || "";
  const messages = result && confirmed ? buildMessages({ result, bill, month, tariff: lookup.tariff, sourceUri, cheeky }) : null;
  const text = messages ? messages[msgLang] : "";
  const pct = result?.overchargePct;

  const jokes = result && {
    rate: result.lines.rate.diff > 0 ? t.jokeRate : null,
    fixed: result.lines.fixed.diff > 0 ? t.jokeFixed(formatLL(result.lines.fixed.official), bill.amps, formatLL(result.lines.fixed.charged)) : null,
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

  const messageOptions = messages && (
    <details className="disclosure message-options">
      <summary>{t.customizeMessage}</summary>
      <div className="toggles">
        <div className="seg" role="group" aria-label="Tone">
          <button type="button" className={!cheeky ? "on" : ""} onClick={() => setCheeky(false)}>{t.polite}</button>
          <button type="button" className={cheeky ? "on" : ""} onClick={() => setCheeky(true)}>{t.cheeky}</button>
        </div>
        <div className="seg" role="group" aria-label="Message language">
          <button type="button" className={msgLang === "en" ? "on" : ""} onClick={() => setMsgLang("en")}>English</button>
          <button type="button" className={msgLang === "ar" ? "on" : ""} onClick={() => setMsgLang("ar")}>عربي</button>
        </div>
      </div>
      <textarea id="msg" className="msg" aria-label={t.msgTitle} dir={msgLang === "ar" ? "rtl" : "ltr"} lang={msgLang} readOnly value={text} rows={7} />
      <button type="button" className="btn primary" onClick={copy}>{copied ? t.copied : t.copy}</button>
      <p className="muted complaint-detail">{t.noFixText}</p>
    </details>
  );

  // ponytail: reuse the same actions and native disclosure on both screens.
  const messagePanel = messages && <div className="message-actions">
    <div className="contact-actions">
      <a className="btn wa" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">{t.whatsapp}</a>
      <a className="btn danger complaint" href="tel:1739">{t.call}</a>
      <p className="complaint-hint">{t.reportOverbilling}</p>
    </div>
    {view === "message" && messageOptions}
  </div>;

  return (
    <section className="verdict enter">
      {view === "bill" && <>
      <div className="headline-row">
        <h1 className="headline">{t.headlines[key]}</h1>
        <img className="mascot" src="/receipt-mascot.png" alt="" width="96" height="96" />
      </div>
      <p className={`status ${confirmed ? "ok" : "warn"}`}>{label} · {zone === "cities" ? t.city : t.village} · {t.status[status]}</p>

      {result && confirmed && (
        <div className="big">
          {result.overchargeLL !== null ? (
            <>
              <span className="big-label">{result.overchargeLL >= 0 ? t.above : t.belowCalc}</span>
              <span className="big-ll">{formatLL(Math.abs(result.overchargeLL))} <small>LL</small></span>
              {result.overchargeUSD !== null && <span className="big-usd">{t.about(formatUSD(result.overchargeUSD), formatLL(result.displayRateLL))}</span>}
              {pct !== null && Math.round(result.overchargeLL) !== 0 && <span className="stamp">{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</span>}
            </>
          ) : (
            <span className="big-label">{t.addAmps}</span>
          )}
        </div>
      )}

      {messagePanel}

      {result && confirmed && (
        <details className="disclosure breakdown">
          <summary>{t.breakdown}</summary>
          <div className="seg breakdown-tabs" role="group" aria-label={t.breakdown}>
            {[["total", t.totalTab], ["rate", t.perKwh], ["fixed", t.fixedTab]].map(([key, title]) => <button type="button" key={key} aria-pressed={breakdown === key} className={breakdown === key ? "on" : ""} onClick={() => setBreakdown(key)}>{title}</button>)}
          </div>
          <Row t={t} name={breakdown === "total" ? t.totalFor(formatLL(bill.kwh)) : breakdown === "rate" ? t.perKwh : t.fixedFee(bill.amps)} line={result.lines[breakdown]} comment={breakdown === "total" ? (bothMatch ? t.jokeBoth : null) : jokes[breakdown]} rate={result.displayRateLL} />
        </details>
      )}

      {messageOptions}
      <Sources t={t} lookup={lookup} />

      {status === "conflict" && (
        <div className="note warn">
          <p>{lookup.reason}</p>
          <p>{t.conflictLive}: {formatLL(lookup.liveTariff?.perKwhCitiesLL)} / {formatLL(lookup.liveTariff?.perKwhRemoteLL)} LL/kWh, {formatLL(lookup.liveTariff?.fixed5LL)} (5 A). {t.conflictSaved}: {formatLL(lookup.savedTariff?.perKwhCitiesLL)} / {formatLL(lookup.savedTariff?.perKwhRemoteLL)}, {formatLL(lookup.savedTariff?.fixed5LL)}.</p>
        </div>
      )}
      {status === "unavailable" && (
        <div className="note warn">
          <p>{lookup.reason || t.status.unavailable}</p>
          <button type="button" className="btn" onClick={onRetry}>{t.retry}</button>
        </div>
      )}

      {warnings.map((w) => <p key={w} className="note">{w}</p>)}
      {!messages && result && confirmed && <p className="note">{t.noComplaint}</p>}
      </>}

      {view === "message" && (messages ? (
        <div className="message">
          <div className="message-head">
            <img src="/icon-message.png" alt="" width="64" height="64" />
            <div>
              <h1 className="page-title">{t.msgTitle}</h1>
              <p className="muted">{t.msgSub}</p>
            </div>
          </div>
          {messagePanel}
        </div>
      ) : (
        <div className="empty-state"><h1 className="page-title">{t.nav.message}</h1><p className="note">{result && confirmed ? t.noComplaint : t.headlines.unconfirmed}</p><button type="button" className="btn" onClick={() => onNavigate("bill")}>{t.backToBill}</button></div>
      ))}
    </section>
  );
}

function Sources({ t, lookup }) {
  const sources = (lookup.sources?.length ? lookup.sources : lookup.savedSources) || [];
  return (
      <details className="sources">
        <summary>{t.sources}</summary>
        <p>{t.status[lookup.status]}</p>
        <p className="muted">{t.searched} {lookup.searchedAt ? new Date(lookup.searchedAt).toLocaleString() : ""}{lookup.referenceCheckedAt && ` · ${t.refChecked} ${lookup.referenceCheckedAt}`}{lookup.tariff?.publicationDate && ` · ${t.published} ${lookup.tariff.publicationDate}`}</p>
        {lookup.tariff && <p className="muted mono">{t.tariffLine(lookup.tariff, formatLL)}</p>}
        <ul>
          {sources.slice(0, 8).map((s) => (
            <li key={s.uri}><a href={s.uri} target="_blank" rel="noopener noreferrer">{s.title}</a></li>
          ))}
        </ul>
        {lookup.searchQueries?.length > 0 && <p className="muted">{t.queries} {lookup.searchQueries.join(" · ")}</p>}
        <p className="muted">{t.disclaimer}</p>
      </details>
  );
}
