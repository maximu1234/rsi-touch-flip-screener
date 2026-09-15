import test from "node:test";
import assert from "node:assert/strict";
import {
  configFingerprint,
  csvEscape,
  escapeHtml,
  sanitizeScreenerSymbol,
  sanitizeScreenerTf
} from "../lib/screener-defaults.js";
import { parseImportFile } from "../lib/import-results.js";
import { rsiTouchFlipTestVerdict } from "../lib/rsi-touch-flip-walkforward.js";
import { buildRsiForLen } from "../src/rsi-prep.js";
import { ScanController } from "../src/scan.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("sanitize rejects path traversal in symbols and TFs", () => {
  assert.equal(sanitizeScreenerSymbol("../etc/passwd"), "");
  assert.equal(sanitizeScreenerSymbol("BTC/../USDT"), "");
  assert.equal(sanitizeScreenerSymbol("<img>"), "");
  assert.equal(sanitizeScreenerSymbol("BTCUSDT"), "BTCUSDT");
  assert.equal(sanitizeScreenerSymbol("1000PEPEUSDT"), "1000PEPEUSDT");
  assert.equal(sanitizeScreenerTf("../5"), "");
  assert.equal(sanitizeScreenerTf("5"), "5");
  assert.equal(sanitizeScreenerTf("D"), "D");
});

test("html and csv escape untrusted cells", () => {
  assert.equal(escapeHtml(`<img src=x onerror=alert(1)>`), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(csvEscape("=CMD"), "'=CMD");
  assert.equal(csvEscape("+1+1"), "'+1+1");
  assert.equal(csvEscape("BTCUSDT"), "BTCUSDT");
});

test("compound overlay does not change scan fingerprint", () => {
  const base = { chartTf: "5", rsiTf: "1", budget: 30 };
  assert.equal(
    configFingerprint({ ...base, compoundEnabled: true }),
    configFingerprint({ ...base, compoundEnabled: false })
  );
  assert.equal(
    configFingerprint({ ...base, cycleSlEnabled: true, cycleSlPct: 40 }),
    configFingerprint({ ...base, cycleSlEnabled: false })
  );
});

test("Test verdict accepts Infinity as a string after compact", () => {
  const v = rsiTouchFlipTestVerdict({
    closedTrades: 12,
    netProfit: 4,
    profitFactor: "Infinity"
  });
  assert.equal(v.ok, true);
});

test("import does not trust ok=yes when Test is negative", () => {
  const csv = [
    "symbol,status,ok,rsiLen,osLevel,obLevel,maxStack,netProfit,trainNet,testNet,testTrades,reasons",
    'EVIL,done,yes,14,30,70,1,40,50,-12,20,""'
  ].join("\n");
  const snap = parseImportFile(csv, "bad.csv");
  assert.equal(snap.rows.EVIL.best.verdict.ok, false);
});

test("RSI TF without source candles throws instead of silent chart RSI", () => {
  const candles = [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
  assert.throws(
    () => buildRsiForLen(candles, [], "5", "1", 14),
    /нет свечей RSI ТФ/
  );
});

test("cache path rejects a traversal symbol", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "rsi-screener-cache-"));
  const controller = new ScanController(root);
  assert.throws(
    () => controller.cacheFile("bybit", "../../tmp", "5"),
    /некорректный/
  );
  const file = controller.cacheFile("bybit", "BTCUSDT", "5");
  assert.ok(file.includes(`${path.sep}BTCUSDT${path.sep}5.json`));
  assert.equal(file.includes(".."), false);
});
