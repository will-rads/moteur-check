// Turning a checked bill into a Moteur Index report.
//
// Moteur Index (moteurindex.com) is a public crowd-reported price index for Lebanese
// generator electricity. A Moteur Check user has already found, photographed and
// verified their bill; if they choose to, those figures can join the index so the
// country's price map gets one district better.
//
// This file is the translation, and it is pure — no network, no env, no side effects —
// so the mapping can be tested against a real invoice. api/contribute.js does the
// posting.
//
// Three rules from the index's methodology are encoded here. They are not arbitrary;
// each one is a mistake the index has already made once and corrected.
//
//   1. TWO PRICING AXES, NEVER BLENDED. A per-kWh price buys energy; a monthly
//      subscription buys an amperage. Converting a subscription into a per-kWh figure
//      requires assuming the household draws its full breaker limit every hour, which
//      none do — that assumption understated Beirut's prices by 2.4x. So a bill that
//      states a per-kWh rate is 'per_kwh', and a fixed fee ALONGSIDE it is a standing
//      charge that goes in the note, not a subscription. Only a bill with no per-kWh
//      rate at all is 'flat'.
//
//   2. THE INDEX PUBLISHES USD. Bills are in lira, so something has to convert, and
//      which rate is used matters: the ministry's August announcement says 89,700 while
//      Banque du Liban's peg is 89,500. Where the bill prints both a lira and a dollar
//      total we use ITS OWN implied rate, because that is what the household was
//      actually billed at. Otherwise the tariff's stated rate. Never a guess, and the
//      note always records which was used.
//
//   3. WE SEND FIGURES, NOT OUR VERDICT. Moteur Check's overcharge percentage is
//      deliberately not part of the payload. The index recomputes the comparison from
//      the raw bill against its own confirmed ceiling, so that every number it publishes
//      came from one methodology. Sending ours would quietly put a second one inside it.

export const MOTEUR_INDEX_URL = "https://moteurindex.com/api/partner/report";

// The 26 qadas, spelled as Moteur Index spells them. A report the index cannot place on
// a district cannot be published, so this list is the contract.
export const DISTRICTS = [
  "Akkar", "Aley", "Baabda", "Baalbek", "Batroun", "Bcharre", "Beirut", "Bent Jbail",
  "Chouf", "El Metn", "Hasbaya", "Hermel", "Jbail", "Jezzine", "Kesrouan", "Koura",
  "Marjaayoun", "Minieh-Dinnieh", "Nabatiye", "Rachaya", "Saida", "Sour", "Tripoli",
  "West Bekaa", "Zahle", "Zgharta",
];

export class ContributeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The rate to divide lira by, and where it came from.
 *
 * Prefers the bill's own arithmetic. An operator who prints "19,740,195 / 89,700 = 220
 * USD" has told us the rate they billed at, and that beats any published figure for
 * describing what this household paid.
 */
export function exchangeRate({ totalLL, totalUSD, tariffRateLL }) {
  const ll = finite(totalLL);
  const usd = finite(totalUSD);
  if (ll !== null && usd !== null && usd > 0 && ll > 0) {
    const implied = ll / usd;
    // Sanity: a printed pair that implies something absurd is an OCR misread, not a rate.
    if (implied > 10000 && implied < 200000) return { rate: implied, source: "bill" };
  }
  const t = finite(tariffRateLL);
  if (t !== null && t > 0) return { rate: t, source: "tariff" };
  return { rate: null, source: null };
}

/**
 * Builds the Moteur Index payload.
 *
 * @param {object} input
 * @param {object} input.bill      normalizeBill()'s `bill`: kwh, rateLL, fixedLL, amps,
 *                                 totalLL, previousReading, currentReading
 * @param {number|null} [input.totalUSD]    the dollar total printed on the bill, if any
 * @param {string} input.district  one of DISTRICTS
 * @param {string} [input.town]    free text; the bill's areaHint is a good default
 * @param {string} input.month     'YYYY-MM' the bill covers
 * @param {string} [input.zone]    'cities' | 'remote' — context only, recorded in the note
 * @param {number|null} [input.tariffRateLL] the tariff's stated LBP/USD
 * @param {string} [input.generatorName]
 * @returns {object} the request body for POST /api/partner/report
 */
export function buildReport(input) {
  const { bill, district, month } = input;
  if (!bill || typeof bill !== "object") throw new ContributeError("No bill to contribute.");
  if (!DISTRICTS.includes(district)) throw new ContributeError("Choose the district the bill is for.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ""))) throw new ContributeError("The bill's month is missing.");

  const { rate, source: rateSource } = exchangeRate({
    totalLL: bill.totalLL,
    totalUSD: finite(input.totalUSD),
    tariffRateLL: input.tariffRateLL,
  });
  if (rate === null) {
    throw new ContributeError("No exchange rate is available, so the bill cannot be converted to dollars.");
  }

  const rateLL = finite(bill.rateLL);
  const fixedLL = finite(bill.fixedLL);
  const amps = finite(bill.amps);

  // Rule 1. A per-kWh rate on the bill makes this a metered report whatever else is on
  // it. The fixed fee is a standing charge alongside metered billing, not a subscription,
  // and folding it into either axis would misrepresent both.
  const metered = rateLL !== null && rateLL > 0;

  if (!metered && (fixedLL === null || amps === null || amps <= 0)) {
    throw new ContributeError(
      "This bill has neither a price per kWh nor a monthly fee with an amperage, so it cannot be compared."
    );
  }

  const notes = [];
  if (metered && fixedLL !== null) {
    // Recorded, not converted. The index tracks subscription pricing in $/ampere/month
    // on its own axis; a standing charge next to a metered rate belongs to neither.
    notes.push(
      `Standing charge ${Math.round(fixedLL).toLocaleString("en-US")} LL/month` +
        (amps ? ` for ${amps}A` : "") +
        ` ($${(fixedLL / rate).toFixed(2)})`
    );
  }
  notes.push(
    rateSource === "bill"
      ? `Converted at ${Math.round(rate).toLocaleString("en-US")} LL/USD, the rate printed on the bill.`
      : `Converted at ${Math.round(rate).toLocaleString("en-US")} LL/USD, the rate stated in the ministry tariff.`
  );
  if (input.zone) notes.push(input.zone === "remote" ? "Village / above 700 m." : "City / below 700 m.");
  if (input.generatorName) notes.push(`Operator: ${String(input.generatorName).slice(0, 60)}.`);
  notes.push("Read from a photographed bill by Moteur Check.");

  const body = {
    // Set by the caller only when the user has actually chosen to contribute. Never
    // defaulted here — a default would make this the app's decision, not the user's.
    consent: true,

    town: String(input.town || "").trim().slice(0, 80) || "(location n/a)",
    district,

    price_type: metered ? "per_kwh" : "flat",
    // Metered: dollars per kWh. Subscription: the monthly fee in dollars.
    price_value: Number(((metered ? rateLL : fixedLL) / rate).toFixed(4)),

    // The last day of the billing month: the index groups by the month a price was paid,
    // and a day within the right month is all that is needed.
    report_date: lastDayOf(month),

    note: notes.join(" ").slice(0, 500),
  };

  if (!metered) {
    body.amperage = amps;
    // The index requires hours of supply for a subscription, because a monthly fee
    // cannot be interpreted without it. Bills do not print it, so the user is asked.
    const hours = finite(input.hoursSupply);
    if (hours === null || hours <= 0) {
      throw new ContributeError("How many hours of supply a day does this subscription give? The index needs it.");
    }
    body.hours_supply = hours;
  } else if (amps !== null) {
    // Context on a metered bill, not a pricing input.
    body.amperage = amps;
  }

  // Rule 3's counterpart: the redundant figures the index uses to verify our OCR by
  // checking the bill's arithmetic closes. Sending more here is strictly better — a
  // misread digit is caught before a human ever sees the row.
  const prev = finite(bill.previousReading);
  const curr = finite(bill.currentReading);
  if (prev !== null && curr !== null && curr >= prev) {
    body.meter_old = prev;
    body.meter_new = curr;
  } else if (finite(bill.kwh) !== null) {
    body.kwh_consumed = bill.kwh;
  }
  if (rateLL !== null) body.unit_price = rateLL;
  if (finite(bill.totalLL) !== null && rateLL !== null && finite(bill.kwh) !== null) {
    // The ENERGY line, which is what unit_price x kwh should equal — not the printed
    // grand total, which also carries the standing charge and any tax.
    body.energy_total = Math.round(bill.kwh * rateLL);
  }

  // VAT is left unset on purpose. Most Lebanese generator operators are unregistered and
  // issue no invoice; the index treats unknown as unknown rather than assuming "no VAT
  // was charged", and Moteur Check has no way to tell which this is.

  return body;
}

/** Last calendar day of a 'YYYY-MM', as 'YYYY-MM-DD'. */
export function lastDayOf(month) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
