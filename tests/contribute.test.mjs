import { strict as assert } from "node:assert";
import test from "node:test";
import { buildReport, lastDayOf, ContributeError } from "../lib/contribute.mjs";
import contribute from "../api/contribute.js";

const BILL = { kwh: 395, rateLL: 48241, fixedLL: 685000, amps: 10, totalLL: 19740195, previousReading: 9805, currentReading: 10200 };
const BASE = { bill: BILL, district: "El Metn", town: "Jal el Dib", month: "2026-08", zone: "cities", tariffRateLL: 89700 };

test("reviewed metered payload uses tariff FX and no invented evidence", () => {
  const report = buildReport(BASE);
  assert.equal(report.price_type, "per_kwh");
  assert.equal(report.price_value, 0.5378);
  assert.equal(report.report_date, "2026-08-31");
  assert.equal(report.kwh_consumed, 395);
  assert.equal(report.unit_price, 48241);
  assert.equal(report.meter_new - report.meter_old, report.kwh_consumed);
  assert.equal(report.amperage, 10);
  assert.match(report.note, /Standing charge 685000 LL/);
  assert.match(report.note, /89700 LL\/USD/);
  assert.match(report.note, /VAT unknown/);
  assert.deepEqual(Object.keys(report).sort(), ["consent", "town", "district", "price_type", "price_value", "report_date", "note", "kwh_consumed", "unit_price", "amperage", "meter_old", "meter_new"].sort());
  // The old hidden OCR dollar total cannot silently halve the map price.
  assert.deepEqual(buildReport({ ...BASE, totalUSD: 120 }), report);
  assert.deepEqual(buildReport({ ...BASE, totalUSD: 220 }), report);
  assert.throws(() => buildReport({ ...BASE, tariffRateLL: null, totalUSD: 220 }), ContributeError);
});

test("missing or invalid metered data cannot become a flat subscription", () => {
  for (const patch of [{ rateLL: null }, { rateLL: 0 }, { rateLL: -1 }, { rateLL: "48241" }, { kwh: null }, { kwh: NaN }, { fixedLL: -1 }, { amps: 0 }, { amps: 2.5 }, { previousReading: null }, { currentReading: 10201 }]) {
    assert.throws(() => buildReport({ ...BASE, bill: { ...BILL, ...patch }, hoursSupply: 20 }), ContributeError);
  }
  const withoutReadings = buildReport({ ...BASE, bill: { ...BILL, previousReading: null, currentReading: null } });
  assert.equal(withoutReadings.kwh_consumed, 395);
  assert.equal("meter_old" in withoutReadings, false);
  assert.equal("energy_total" in withoutReadings, false);
  assert.equal("energy_total" in buildReport({ ...BASE, bill: { ...BILL, rateLL: 4824 } }), false);
});

test("district, month, zone and exchange rate are validated", () => {
  for (const patch of [{ district: "Metn" }, { month: "2026-13" }, { zone: "unknown" }, { tariffRateLL: 0 }, { tariffRateLL: "89700" }]) assert.throws(() => buildReport({ ...BASE, ...patch }), ContributeError);
  assert.equal(lastDayOf("2028-02"), "2028-02-29");
  assert.equal(buildReport({ ...BASE, town: "" }).town, "(location n/a)");
});

test("printed totals require explicit confirmation and preserve independent evidence", () => {
  for (const printedTotalsConfirmed of [undefined, false, "true", 1]) {
    const report = buildReport({ ...BASE, printedTotalsConfirmed });
    assert.equal("printed_total" in report, false);
    assert.equal("standing_charge" in report, false);
  }
  const confirmed = { ...BASE, printedTotalsConfirmed: true };
  const report = buildReport(confirmed);
  assert.equal(report.printed_total, 19740195);
  assert.equal(report.standing_charge, 685000);
  assert.equal(report.printed_total - report.standing_charge, 395 * 48241);
  assert.equal("energy_total" in report, false);
  assert.match(report.note, /User confirmed the printed total is before VAT/);
  // A misread price cannot change either independent printed amount to make it fit.
  const badPrice = buildReport({ ...confirmed, bill: { ...BILL, rateLL: 4824 } });
  assert.notEqual(badPrice.printed_total - badPrice.standing_charge, badPrice.kwh_consumed * badPrice.unit_price);
  assert.equal(buildReport({ ...confirmed, bill: { ...BILL, fixedLL: 0 } }).standing_charge, 0);
  for (const patch of [{ fixedLL: null }, { fixedLL: undefined }, { totalLL: null }, { totalLL: -1 }, { totalLL: NaN }, { totalLL: Infinity }, { totalLL: "19740195" }, { totalLL: 100 }]) {
    assert.throws(() => buildReport({ ...confirmed, bill: { ...BILL, ...patch } }), ContributeError);
  }
  const unknown = buildReport({ ...BASE, bill: { ...BILL, fixedLL: null, totalLL: null } });
  assert.equal("printed_total" in unknown, false);
  assert.equal("standing_charge" in unknown, false);
});

test("configuration, consent and partner responses are enforced without live submissions", async () => {
  const originalKey = process.env.MOTEUR_INDEX_KEY;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let upstreamStatus = 202;
  let expectedReport = buildReport(BASE);
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.headers["X-Partner-Key"], "test-key");
    assert.deepEqual(JSON.parse(options.body), expectedReport);
    return { ok: upstreamStatus >= 200 && upstreamStatus < 300, status: upstreamStatus, json: async () => ({ reconciled: true, reconcile_depth: "partial" }) };
  };
  async function request(method, body) {
    const req = { method, body, headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" }, socket: { remoteAddress: "test-contribution" } };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = JSON.parse(v); } };
    await contribute(req, res);
    return res;
  }
  try {
    delete process.env.MOTEUR_INDEX_KEY;
    assert.deepEqual((await request("GET")).body, { enabled: false });
    assert.equal((await request("POST", { ...BASE, consent: true })).statusCode, 503);
    process.env.MOTEUR_INDEX_KEY = "test-key";
    const config = await request("GET");
    assert.deepEqual(config.body, { enabled: true });
    assert.equal(config.headers["Cache-Control"], "no-store");
    assert.equal((await request("POST", { ...BASE, consent: false })).statusCode, 400);
    assert.equal((await request("POST", { ...BASE, consent: true, bill: { ...BILL, rateLL: null } })).statusCode, 400);
    assert.equal(calls, 0);
    const queued = await request("POST", { ...BASE, consent: true });
    assert.equal(queued.body.status, "queued");
    assert.equal(queued.statusCode, 200);
    assert.equal(calls, 1);
    const confirmed = { ...BASE, consent: true, printedTotalsConfirmed: true };
    expectedReport = buildReport(confirmed);
    assert.equal((await request("POST", confirmed)).statusCode, 200);
    assert.equal(calls, 2);
    assert.equal((await request("POST", { ...confirmed, bill: { ...BILL, fixedLL: null } })).statusCode, 400);
    assert.equal(calls, 2);
    expectedReport = buildReport(BASE);
    upstreamStatus = 200;
    assert.equal((await request("POST", { ...BASE, consent: true })).statusCode, 502);
    upstreamStatus = 429;
    assert.equal((await request("POST", { ...BASE, consent: true })).statusCode, 429);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.MOTEUR_INDEX_KEY;
    else process.env.MOTEUR_INDEX_KEY = originalKey;
  }
});
