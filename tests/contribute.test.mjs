// Turning a checked bill into a Moteur Index report.
//
// The fixture is a real K L services sal invoice (Dawra / Mar Youssef, 28/8/2026),
// which is arithmetically closed: 10,200 - 9,805 = 395 kWh, 395 x 48,241 = 19,055,195 LL,
// plus a 685,000 LL standing charge for 10 A, and it prints its own exchange rate as
// 19,740,195 / 89,700 = 220.00 USD. Real numbers, so a broken mapping fails against a
// document rather than against numbers chosen to make it pass.

import { strict as assert } from "node:assert";
import test from "node:test";
import { buildReport, exchangeRate, lastDayOf, ContributeError, DISTRICTS } from "../lib/contribute.mjs";

const BILL = {
  kwh: 395,
  rateLL: 48241,
  fixedLL: 685000,
  amps: 10,
  totalLL: 19740195,
  previousReading: 9805,
  currentReading: 10200,
};

const BASE = { bill: BILL, district: "El Metn", town: "Jal el Dib", month: "2026-08", zone: "cities", tariffRateLL: 89700 };

test("exchangeRate prefers the bill's own printed rate", () => {
  // The operator divided by 89,700. That is what this household was billed at, whatever
  // any published figure says.
  const r = exchangeRate({ totalLL: 19740195, totalUSD: 220, tariffRateLL: 89500 });
  assert.equal(r.source, "bill");
  assert.ok(Math.abs(r.rate - 89728) < 50);
});

test("exchangeRate falls back to the tariff when the bill prints no dollars", () => {
  const r = exchangeRate({ totalLL: 19740195, totalUSD: null, tariffRateLL: 89700 });
  assert.deepEqual(r, { rate: 89700, source: "tariff" });
});

test("exchangeRate rejects an absurd implied rate as an OCR misread", () => {
  // A dollar total misread as 22,000 would imply ~897 LL/USD. Falling back is right;
  // using it would publish a price a hundred times too high.
  const r = exchangeRate({ totalLL: 19740195, totalUSD: 22000, tariffRateLL: 89700 });
  assert.equal(r.source, "tariff");
});

test("a metered bill becomes a per_kwh report", () => {
  const body = buildReport(BASE);
  assert.equal(body.price_type, "per_kwh");
  // 48,241 / 89,700 = 0.5378
  assert.ok(Math.abs(body.price_value - 0.5378) < 0.0002, `got ${body.price_value}`);
  assert.equal(body.district, "El Metn");
  assert.equal(body.report_date, "2026-08-31");
});

test("a standing charge stays out of the price and goes in the note", () => {
  // The rule that matters most. 685,000 LL/month for 10 A sits ALONGSIDE metered
  // billing; it is not a subscription and must not touch price_value on either axis.
  const body = buildReport(BASE);
  assert.equal(body.price_type, "per_kwh");
  assert.ok(body.note.includes("685,000 LL/month"));
  assert.ok(body.note.includes("10A"));
  // And the per-ampere axis is untouched: amperage is context here, not pricing.
  assert.equal(body.amperage, 10);
});

test("a pure subscription becomes a flat report, with hours", () => {
  const sub = { ...BASE, bill: { ...BILL, rateLL: null, kwh: 0 }, hoursSupply: 20 };
  const body = buildReport(sub);
  assert.equal(body.price_type, "flat");
  // 685,000 / 89,700 = $7.64/month for 10 A
  assert.ok(Math.abs(body.price_value - 7.6366) < 0.001, `got ${body.price_value}`);
  assert.equal(body.amperage, 10);
  assert.equal(body.hours_supply, 20);
});

test("a subscription without hours is refused rather than guessed", () => {
  // The index excludes a flat report it cannot interpret, so sending one without hours
  // would quietly discard the contribution.
  const sub = { ...BASE, bill: { ...BILL, rateLL: null, kwh: 0 } };
  assert.throws(() => buildReport(sub), ContributeError);
});

test("the meter readings are sent for the index to cross-check", () => {
  const body = buildReport(BASE);
  assert.equal(body.meter_old, 9805);
  assert.equal(body.meter_new, 10200);
  assert.equal(body.unit_price, 48241);
  // The ENERGY line, not the printed grand total -- the total includes the standing
  // charge, and sending it would make the index's own check fail on a correct bill.
  assert.equal(body.energy_total, 19055195);
});

test("energy_total times nothing else equals the bill's own energy line", () => {
  const body = buildReport(BASE);
  assert.equal(body.meter_new - body.meter_old, 395);
  assert.equal(395 * body.unit_price, body.energy_total);
});

test("a bad district is refused, because the index cannot map it", () => {
  assert.throws(() => buildReport({ ...BASE, district: "Metn" }), ContributeError);
  assert.throws(() => buildReport({ ...BASE, district: "" }), ContributeError);
  assert.ok(DISTRICTS.includes("El Metn"));
});

test("no verdict, percentage or overcharge is ever sent", () => {
  // Moteur Check's comparison is its own. The index recomputes from the raw bill so
  // that every figure it publishes came from one methodology.
  const body = buildReport(BASE);
  const keys = Object.keys(body).join(" ");
  for (const banned of ["overcharge", "pct", "percent", "verdict", "diff", "official"]) {
    assert.ok(!keys.includes(banned), `payload must not carry ${banned}`);
  }
});

test("the payload carries only the fields the index was promised", () => {
  // An allow-list rather than a search for banned words: prose legitimately contains
  // "photographed bill", and a substring check on the whole JSON flags that while
  // missing a genuinely new field. This way any addition has to be deliberate, and a
  // future change that starts sending a photo, a phone number or a user id fails here.
  const permitted = new Set([
    "consent", "town", "district", "price_type", "price_value", "amperage",
    "hours_supply", "report_date", "note", "meter_old", "meter_new", "kwh_consumed",
    "unit_price", "energy_total",
  ]);
  const body = buildReport({ ...BASE, generatorName: "K L services sal", hoursSupply: 20 });
  for (const key of Object.keys(body)) {
    assert.ok(permitted.has(key), `unexpected field in payload: ${key}`);
  }
  // The operator's name is business information printed on the bill, not personal data,
  // and it is useful context for a moderator.
  assert.ok(body.note.includes("K L services"));
});

test("VAT is left unknown rather than assumed", () => {
  // Most operators are unregistered and issue no invoice. "Nobody asked" and "no VAT
  // was charged" are different claims, and we cannot tell which this is.
  assert.equal("vat_included" in buildReport(BASE), false);
});

test("lastDayOf handles month lengths and leap years", () => {
  assert.equal(lastDayOf("2026-08"), "2026-08-31");
  assert.equal(lastDayOf("2026-09"), "2026-09-30");
  assert.equal(lastDayOf("2026-02"), "2026-02-28");
  assert.equal(lastDayOf("2028-02"), "2028-02-29");
});

test("a bill with neither a rate nor an amperage fee is refused", () => {
  assert.throws(
    () => buildReport({ ...BASE, bill: { ...BILL, rateLL: null, fixedLL: null, amps: null } }),
    ContributeError
  );
});
