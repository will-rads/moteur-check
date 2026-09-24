// Only reviewed metered bills are contributed. Missing fields never imply a subscription.
export const MOTEUR_INDEX_URL = "https://moteurindex.com/api/partner/report";

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

// Shared by the preview and the server; no network or secrets here.
export function buildReport(input) {
  const { bill, district, month, tariffRateLL: rate } = input;
  if (!bill || typeof bill !== "object") throw new ContributeError("No bill to contribute.");
  if (!DISTRICTS.includes(district)) throw new ContributeError("Choose the district the bill is for.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ""))) throw new ContributeError("The bill's month is missing.");
  if (!["cities", "remote"].includes(input.zone)) throw new ContributeError("Choose the bill's area category.");
  if (!Number.isFinite(rate) || rate <= 0) throw new ContributeError("No confirmed tariff exchange rate is available.");
  for (const key of ["rateLL", "kwh", "fixedLL", "amps", "previousReading", "currentReading"]) {
    const value = bill[key];
    if (value != null && (!Number.isFinite(value) || value < 0)) throw new ContributeError(`Check the bill's ${key}.`);
  }
  if (!(bill.rateLL > 0)) throw new ContributeError("Confirm the price per kWh before sharing. Flat subscriptions are not supported.");
  if (!Number.isFinite(bill.kwh)) throw new ContributeError("Confirm the consumption before sharing.");
  if (bill.amps != null && (!Number.isInteger(bill.amps) || bill.amps <= 0)) throw new ContributeError("Check the bill's amperage.");
  const prev = bill.previousReading;
  const curr = bill.currentReading;
  if ((prev != null) !== (curr != null)) throw new ContributeError("Enter both meter readings, or leave both blank.");
  if (prev != null && (curr < prev || Math.abs(curr - prev - bill.kwh) > 0.01)) {
    throw new ContributeError("Meter readings do not match consumption. Correct the bill before sharing.");
  }

  // ponytail: use the confirmed tariff rate. Supporting operator FX needs a reviewed
  // exchange-rate field; an invisible OCR dollar total must not decide the map price.
  const notes = [];
  if (bill.fixedLL != null) notes.push(`Standing charge ${bill.fixedLL} LL/month` + (bill.amps ? ` for ${bill.amps}A` : "") + ".");
  notes.push(`Converted at ${rate} LL/USD, the rate stated in the ministry tariff.`);
  notes.push(input.zone === "remote" ? "Village / remote tariff zone." : "City tariff zone.");
  notes.push("Read from a photographed bill by Moteur Check. Energy subtotal not independently extracted; VAT unknown.");
  const body = {
    consent: true, // The API checks explicit consent before calling this mapper.
    town: String(input.town || "").trim().slice(0, 80) || "(location n/a)",
    district,
    price_type: "per_kwh",
    price_value: Number((bill.rateLL / rate).toFixed(4)),
    report_date: lastDayOf(month),
    note: notes.join(" "),
    kwh_consumed: bill.kwh,
    unit_price: bill.rateLL,
  };
  if (!(body.price_value > 0)) throw new ContributeError("The converted price is too small. Check the bill's unit price.");
  if (bill.amps != null) body.amperage = bill.amps;
  if (prev != null) {
    body.meter_old = prev;
    body.meter_new = curr;
  }
  // Do not manufacture energy_total = kWh * price: it cannot independently verify OCR.
  // VAT, bill photo, personal details, grand total and our verdict are not submitted.
  return body;
}

export function lastDayOf(month) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
