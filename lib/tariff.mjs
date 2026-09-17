// Moteur Check: tariff references, validation and the comparison math.
// The math lives here, never in the model. Integer LBP throughout; round only for display.

export class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const DISPLAY_RATE_LL_PER_USD = 89700; // stated in the July/August ministry announcements

export const ZONES = {
  cities: "Cities, dense areas, or below 700 m",
  remote: "Villages, remote areas, or above 700 m",
};

// Saved references: months already verified by hand (see PLAN.md section 3).
export const SAVED_REFERENCES = {
  "2026-08": {
    month: "2026-08",
    perKwhCitiesLL: 48241,
    perKwhRemoteLL: 53065,
    fixed5LL: 385000,
    fixed10LL: 685000,
    extra5LL: 300000,
    dieselCanLL: 2415495,
    exchangeRateLL: 89700,
    publicationDate: "2026-08-31",
    checkedAt: "2026-09-17",
    sources: [
      { title: "Annahar: ministry statement, August 2026 generator tariff", uri: "https://www.annahar.com/lebanon/342933/لبنان---هكذا-أصبحت-تسعيرة-المولدات-الخاصة-في-ب" },
      { title: "L'Orient Today: generator rates at highest since April", uri: "https://today.lorientlejour.com/article/1546224/generator-rates-in-lebanon-at-highest-since-april.html" },
    ],
  },
  "2026-07": {
    month: "2026-07",
    perKwhCitiesLL: 40746,
    perKwhRemoteLL: 44821,
    fixed5LL: 385000,
    fixed10LL: 685000,
    extra5LL: 300000,
    dieselCanLL: 1992150,
    exchangeRateLL: 89700,
    publicationDate: "2026-07-28",
    checkedAt: "2026-09-17",
    sources: [
      { title: "LBCI: ministry statement, July 2026 generator tariff", uri: "https://www.lbcgroup.tv/infographics/lebanon-business/949390/اليكم-تسعيرة-المولدات-الخاصة-في-شهر-تموز-2026/ar" },
      { title: "Daily Beirut: Ministry of Energy announces July 2026 generator prices", uri: "https://dailybeirut.com/en/lebanon-news/here-is-the-pricing-of-private-generators-for-july-2026/" },
    ],
  },
};

const TARIFF_FIELDS = ["perKwhCitiesLL", "perKwhRemoteLL", "fixed5LL", "fixed10LL", "extra5LL"];

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

// Accepts numbers or printed strings: "19,550,000", "١٩٫٥٥٠٫٠٠٠", "60 000". Returns a finite number or null.
export function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (!text) return null;
  text = text.replace(/[٠-٩]/g, (d) => ARABIC_DIGITS.indexOf(d)).replace(/[۰-۹]/g, (d) => PERSIAN_DIGITS.indexOf(d));
  text = text.replace(/[\s,٬']/g, "").replace(/٫/g, ".");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

const asInteger = (value) => {
  const n = parseAmount(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
};

export function validateMonth(value) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new RequestError("Pick the bill's month and year.");
  const year = Number(value.slice(0, 4));
  if (year < 2022 || year > 2035) throw new RequestError("That year is outside the supported range.");
  return value;
}

export function validateZone(value) {
  if (value !== "cities" && value !== "remote") throw new RequestError("Confirm the bill's area category first.");
  return value;
}

// A tariff is complete when every rate and fee is a non-negative integer.
export function validateTariff(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const tariff = {};
  for (const field of TARIFF_FIELDS) {
    const n = asInteger(candidate[field]);
    if (n === null || n === 0) return null;
    tariff[field] = n;
  }
  tariff.dieselCanLL = asInteger(candidate.dieselCanLL);
  tariff.exchangeRateLL = asInteger(candidate.exchangeRateLL);
  tariff.publicationDate = typeof candidate.publicationDate === "string" ? candidate.publicationDate : null;
  return tariff;
}

export function tariffsMatch(a, b) {
  return TARIFF_FIELDS.every((field) => a?.[field] === b?.[field]);
}

export function fixedFee(amps, tariff) {
  if (!Number.isInteger(amps) || amps <= 0) return null;
  if (amps === 5) return tariff.fixed5LL;
  if (amps === 10) return tariff.fixed10LL;
  if (amps > 10 && amps % 5 === 0) return tariff.fixed10LL + ((amps - 10) / 5) * tariff.extra5LL;
  return null; // ponytail: no published rule for 3A, 7A, 12A; never round into a tier.
}

export function rateFor(zone, tariff) {
  return zone === "remote" ? tariff.perKwhRemoteLL : tariff.perKwhCitiesLL;
}

// Cleans the fields the user confirmed on screen. Missing stays null, never zero.
export function normalizeBill(input) {
  if (!input || typeof input !== "object") throw new RequestError("Enter the bill's numbers first.");
  const bill = {
    kwh: parseAmount(input.kwh),
    rateLL: parseAmount(input.rateLL),
    fixedLL: parseAmount(input.fixedLL),
    amps: parseAmount(input.amps),
    totalLL: parseAmount(input.totalLL),
    previousReading: parseAmount(input.previousReading),
    currentReading: parseAmount(input.currentReading),
  };
  const warnings = [];
  for (const [key, value] of Object.entries(bill)) if (value !== null && value < 0) throw new RequestError(`${key} cannot be negative.`);
  if (bill.kwh === null) throw new RequestError("How many kWh were consumed? That number is needed.");
  if (bill.amps !== null && !Number.isInteger(bill.amps)) throw new RequestError("Amps should be a whole number.");
  if (bill.previousReading !== null && bill.currentReading !== null) {
    const metered = bill.currentReading - bill.previousReading;
    if (metered !== bill.kwh) warnings.push(`Meter readings give ${formatLL(metered)} kWh but the bill says ${formatLL(bill.kwh)} kWh. Check which is right.`);
  }
  if (bill.rateLL !== null && bill.fixedLL !== null && bill.totalLL !== null) {
    const computed = bill.kwh * bill.rateLL + bill.fixedLL;
    if (Math.abs(computed - bill.totalLL) > 1) warnings.push(`kWh × rate + fixed fee is ${formatLL(computed)} LL, but the printed total is ${formatLL(bill.totalLL)} LL. The difference may be arrears, a deposit, tax or a credit.`);
  }
  return { bill, warnings };
}

// The comparison. Returns null lines for anything the bill did not state.
export function compare({ bill, zone, tariff, displayRateLL = DISPLAY_RATE_LL_PER_USD }) {
  const rate = rateFor(zone, tariff);
  const fixed = bill.amps === null ? null : fixedFee(bill.amps, tariff);
  if (bill.amps !== null && fixed === null) throw new RequestError(`No published fixed fee for ${bill.amps} amps. The tariff lists 5 A, 10 A and 5 A steps above 10.`);
  const fairTotal = fixed === null ? null : bill.kwh * rate + fixed;
  const chargedTotal = bill.totalLL ?? (bill.rateLL !== null && bill.fixedLL !== null ? bill.kwh * bill.rateLL + bill.fixedLL : null);
  const line = (charged, official) => ({
    charged,
    official,
    diff: charged === null || official === null ? null : charged - official,
    pct: charged === null || official === null || official === 0 ? null : (100 * (charged - official)) / official,
  });
  const lines = {
    rate: line(bill.rateLL, rate),
    fixed: line(bill.fixedLL, fixed),
    total: line(chargedTotal, fairTotal),
  };
  const overcharge = lines.total.diff;
  return {
    zone,
    lines,
    fairTotalLL: fairTotal,
    chargedTotalLL: chargedTotal,
    overchargeLL: overcharge,
    overchargePct: lines.total.pct,
    overchargeUSD: overcharge === null || !displayRateLL ? null : overcharge / displayRateLL,
    displayRateLL: displayRateLL || null,
  };
}

export function verdictKey(result, status) {
  if (!["live-matched", "live-sourced", "saved-reference"].includes(status)) return "unconfirmed";
  const over = result.overchargeLL;
  const pct = result.overchargePct;
  if (over === null || pct === null) return "unconfirmed";
  if (Math.round(over) < 0) return "below";
  if (Math.round(over) === 0) return "clean";
  if (pct < 2) return "tiny";
  if (pct < 15) return "small";
  if (pct <= 40) return "big";
  return "huge";
}

export const HEADLINES = {
  below: "Below the published tariff. A pleasant plot twist.",
  clean: "Clean bill. Your moteur guy is a rare species. Frame this.",
  tiny: "A small extra. Still worth checking.",
  small: "A little extra. The rounding seems to have picked a side.",
  big: "That's not maintenance. That's a second salary.",
  huge: "Your generator runs on your money, not diesel.",
  unconfirmed: "Let's confirm the tariff before judging the bill.",
};

export function formatLL(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function formatUSD(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `$${Math.abs(n).toFixed(2)}`;
}

export const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHS_AR = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

export function monthLabel(month, lang = "en") {
  const [y, m] = month.split("-").map(Number);
  return lang === "ar" ? `${MONTHS_AR[m - 1]} ${y}` : `${MONTHS_EN[m - 1]} ${y}`;
}

// The message to the moteur guy. Only for a supported, positive overcharge with all three lines known.
export function buildMessages({ result, bill, month, tariff, sourceUri, cheeky = false }) {
  const { lines } = result;
  if (result.overchargeLL === null || result.overchargeLL <= 0 || lines.rate.charged === null || lines.fixed.charged === null || bill.amps === null) return null;
  const en = monthLabel(month, "en");
  const ar = monthLabel(month, "ar");
  const rate = rateFor(result.zone, tariff);
  const fixed = fixedFee(bill.amps, tariff);
  const usd = result.overchargeUSD === null ? "" : ` (about ${formatUSD(result.overchargeUSD)})`;
  const usdAr = result.overchargeUSD === null ? "" : ` (حوالي ${Math.abs(result.overchargeUSD).toFixed(2)}$)`;
  const monthEn = en.split(" ")[0];
  const monthAr = ar.split(" ")[0];
  const src = sourceUri ? `\nSource: ${sourceUri}` : "";
  const srcAr = sourceUri ? `\nالمصدر: ${sourceUri}` : "";
  const openEn = cheeky ? "Apparently my electricity comes with a VIP upgrade 😂 Can we check this difference?" : `Hi, quick one about the ${monthEn} bill 🙂`;
  const openAr = cheeky ? "شكلها الكهربا عندي صارت VIP 😂 فينا نراجع هالفرق؟" : `مرحبا، سؤال سريع عن فاتورة ${monthAr} 🙂`;
  return {
    en: `${openEn}\nThe Ministry's ${monthEn} tariff is ${formatLL(rate)} LL per kWh and ${formatLL(fixed)} LL fixed for ${bill.amps} amps.\nMy bill shows ${formatLL(lines.rate.charged)} per kWh and ${formatLL(lines.fixed.charged)} fixed. For ${formatLL(bill.kwh)} kWh that's ${formatLL(result.overchargeLL)} LL${usd} above the published calculation. Could you clarify the difference and correct it if needed?${src}`,
    ar: `${openAr}\nتسعيرة الوزارة لشهر ${monthAr} هي ${formatLL(rate)} ل.ل. للكيلوواط و${formatLL(fixed)} ل.ل. مقطوعية لـ${bill.amps} أمبير.\nالفاتورة عندي ${formatLL(lines.rate.charged)} للكيلوواط و${formatLL(lines.fixed.charged)} مقطوعية. يعني على ${formatLL(bill.kwh)} كيلوواط في فرق ${formatLL(result.overchargeLL)} ل.ل.${usdAr} عن الحسبة حسب التسعيرة المنشورة.\nفيك توضّحلي الفرق ونصحّحه إذا في غلطة؟${srcAr}`,
  };
}
