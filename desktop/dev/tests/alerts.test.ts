import assert from "node:assert/strict";
import { test } from "node:test";
import { REPEAT_COOLDOWN_MS, evaluate, eventText, newAlert, parseAlerts, rearm, watchedSymbols } from "../../../adapters/alerts.ts";

let n = 0;
const id = () => `e${++n}`;
const T = 1_793_440_000_000;

test("an alert armed below its price fires once when the price reaches it", () => {
  const a = newAlert("a1", "OKX:BTCUSDT", 78_000, 77_500, T);
  assert.equal(a.side, "below");
  let r = evaluate([a], "OKX:BTCUSDT", 77_900, T + 1000, id);
  assert.equal(r.fired.length, 0);
  r = evaluate(r.alerts, "OKX:BTCUSDT", 78_010, T + 2000, id);
  assert.equal(r.fired.length, 1);
  assert.deepEqual([r.fired[0]!.direction, r.fired[0]!.mid], ["up", 78_010]);
  assert.deepEqual([r.alerts[0]!.status, r.alerts[0]!.count, r.alerts[0]!.side], ["triggered", 1, "above"]);
  // Triggered once-alerts stay quiet afterwards.
  r = evaluate(r.alerts, "OKX:BTCUSDT", 77_000, T + 3000, id);
  assert.equal(r.fired.length, 0);
});

test("a gap between polls still counts as a crossing (price jumps past the level)", () => {
  const a = newAlert("a1", "XAUUSD", 3_900, 3_950, T);
  assert.equal(a.side, "above");
  const r = evaluate([a], "XAUUSD", 3_850, T + 15_000, id);
  assert.equal(r.fired[0]!.direction, "down");
});

test("every-time alerts fire on each crossing, at most once per cooldown", () => {
  let alerts = [newAlert("a1", "EURUSD", 1.1, 1.09, T, "repeat")] as const;
  let r = evaluate(alerts, "EURUSD", 1.101, T + 1000, id);
  assert.equal(r.fired.length, 1);
  assert.equal(r.alerts[0]!.status, "active");
  // Back down within the cooldown: no alert, but the side follows the price.
  r = evaluate(r.alerts, "EURUSD", 1.099, T + 20_000, id);
  assert.equal(r.fired.length, 0);
  assert.equal(r.alerts[0]!.side, "below");
  // Up again after the cooldown: fires.
  r = evaluate(r.alerts, "EURUSD", 1.102, T + 1000 + REPEAT_COOLDOWN_MS + 1, id);
  assert.equal(r.fired.length, 1);
  assert.equal(r.alerts[0]!.count, 2);
  alerts = r.alerts as typeof alerts;
  assert.ok(alerts.length === 1);
});

test("other symbols, paused alerts and junk prices are left alone; unchanged lists keep their identity", () => {
  const list = [newAlert("a1", "A", 10, 9, T), { ...newAlert("a2", "B", 10, 9, T), status: "paused" as const }];
  const same = evaluate(list, "B", 11, T, id);
  assert.equal(same.alerts, list);
  assert.equal(same.fired.length, 0);
  assert.equal(evaluate(list, "A", NaN, T, id).alerts, list);
  assert.equal(evaluate(list, "A", 9.5, T, id).alerts, list);
});

test("an alert made without a price arms on the first tick, and re-arming follows the market", () => {
  const a = newAlert("a1", "X", 5, null, T);
  assert.equal(a.side, null);
  const r = evaluate([a], "X", 6, T, id);
  assert.equal(r.fired.length, 0);
  assert.equal(r.alerts[0]!.side, "above");
  const done = { ...r.alerts[0]!, status: "triggered" as const };
  assert.deepEqual([rearm(done, 4).status, rearm(done, 4).side], ["active", "below"]);
});

test("helpers: event text, watched symbols, parsing", () => {
  const r = evaluate([newAlert("a1", "MEXC:PEPEUSDT", 0.00001, 0.000009, T, "once", "breakout")], "MEXC:PEPEUSDT", 0.0000101, T, id);
  assert.equal(eventText(r.fired[0]!), "MEXC:PEPEUSDT crossed up 0.00001 (now 0.0000101) · breakout");
  assert.deepEqual(watchedSymbols([newAlert("1", "A", 1, 0, T), newAlert("2", "A", 2, 0, T), { ...newAlert("3", "B", 1, 0, T), status: "paused" }]), ["A"]);
  assert.equal(parseAlerts('[{"id":"x","symbol":"A","price":1},{"id":2},null]').length, 1);
  assert.deepEqual(parseAlerts("nonsense"), []);
});
