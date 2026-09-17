import test from "node:test";
import assert from "node:assert/strict";
import { SAVED_REFERENCES, buildMessages, compare, fixedFee, normalizeBill, parseAmount, validateTariff, verdictKey } from "../lib/tariff.mjs";

const aug = SAVED_REFERENCES["2026-08"];
const jul = SAVED_REFERENCES["2026-07"];

test("the real August bill: exact expected verdict", () => {
  const { bill, warnings } = normalizeBill({ kwh: 311, rateLL: "60,000", fixedLL: 890000, amps: 5, totalLL: "19,550,000", previousReading: 1690, currentReading: 2001 });
  assert.deepEqual(warnings, []);
  const r = compare({ bill, zone: "cities", tariff: aug });
  assert.equal(r.fairTotalLL, 15387951);
  assert.equal(r.overchargeLL, 4162049);
  assert.equal(r.lines.rate.diff, 11759);
  assert.equal(r.lines.fixed.diff, 505000);
  assert.ok(Math.abs(r.overchargePct - 27.04745) < 0.0001);
  assert.equal(r.overchargeUSD.toFixed(2), "46.40");
  assert.equal(verdictKey(r, "live-matched"), "big");
  const m = buildMessages({ result: r, bill, month: "2026-08", tariff: aug, sourceUri: "https://x" });
  assert.match(m.en, /48,241 LL per kWh and 385,000 LL fixed for 5 amps/);
  assert.match(m.en, /4,162,049 LL \(about \$46.40\)/);
  assert.match(m.ar, /فاتورة آب/);
  const cheeky = buildMessages({ result: r, bill, month: "2026-08", tariff: aug, cheeky: true });
  assert.match(cheeky.en, /VIP upgrade/);
});

test("July, remote, 10A and 15A", () => {
  assert.equal(fixedFee(10, jul), 685000);
  assert.equal(fixedFee(15, jul), 985000);
  assert.equal(fixedFee(7, jul), null);
  assert.equal(fixedFee(12, jul), null);
  const { bill } = normalizeBill({ kwh: 100, rateLL: 44821, fixedLL: 985000, amps: 15, totalLL: 100 * 44821 + 985000 });
  const r = compare({ bill, zone: "remote", tariff: jul });
  assert.equal(r.overchargeLL, 0);
  assert.equal(verdictKey(r, "saved-reference"), "clean");
});

test("synthetic month with different fixed fees is not hardcoded", () => {
  const synthetic = validateTariff({ perKwhCitiesLL: 10000, perKwhRemoteLL: 11000, fixed5LL: 100000, fixed10LL: 200000, extra5LL: 50000 });
  const { bill } = normalizeBill({ kwh: 10, rateLL: 10000, fixedLL: 250000, amps: 20, totalLL: 350000 });
  const r = compare({ bill, zone: "cities", tariff: synthetic });
  assert.equal(r.fairTotalLL, 100000 + 300000);
  assert.equal(r.overchargeLL, -50000);
  assert.equal(verdictKey(r, "live-sourced"), "below");
});

test("edge cases: zero kwh, unsupported amps, unconfirmed status, no message when not over", () => {
  const zero = compare({ bill: normalizeBill({ kwh: 0, rateLL: 48241, fixedLL: 385000, amps: 5, totalLL: 385000 }).bill, zone: "cities", tariff: aug });
  assert.equal(zero.overchargePct, 0);
  assert.throws(() => compare({ bill: normalizeBill({ kwh: 10, amps: 7 }).bill, zone: "cities", tariff: aug }), /7 amps/);
  assert.equal(verdictKey(zero, "conflict"), "unconfirmed");
  assert.equal(buildMessages({ result: zero, bill: { amps: 5, kwh: 0 }, month: "2026-08", tariff: aug }), null);
  const small = compare({ bill: normalizeBill({ kwh: 311, rateLL: 48500, fixedLL: 385000, amps: 5, totalLL: 311 * 48500 + 385000 }).bill, zone: "cities", tariff: aug });
  assert.equal(verdictKey(small, "live-matched"), "tiny");
});

test("discrepancy warnings and Arabic digits", () => {
  assert.equal(parseAmount("١٩,٥٥٠,٠٠٠"), 19550000);
  assert.equal(parseAmount("60 000"), 60000);
  assert.equal(parseAmount(""), null);
  const { warnings } = normalizeBill({ kwh: 300, rateLL: 60000, fixedLL: 890000, amps: 5, totalLL: 19550000, previousReading: 1690, currentReading: 2001 });
  assert.equal(warnings.length, 2);
  assert.throws(() => normalizeBill({ kwh: -1 }), /negative/);
  assert.equal(validateTariff({ perKwhCitiesLL: 1, perKwhRemoteLL: 2, fixed5LL: 3, fixed10LL: null, extra5LL: 5 }), null);
});
