import test from "node:test";
import assert from "node:assert/strict";
import { parseImportFile } from "../lib/import-results.js";

test("imports JSON export with rows array", () => {
  const snap = parseImportFile(
    JSON.stringify({
      config: { chartTf: "5", rsiTf: "1", budget: 30 },
      rows: [
        {
          symbol: "BTCUSDT",
          status: "done",
          best: {
            combo: { rsiLen: 14, osLevel: 30, obLevel: 70, maxStack: 2 },
            overview: { netProfit: 12.5, closedTrades: 40 },
            test: { netProfit: 4.2, closedTrades: 12, profitFactor: 1.3 },
            verdict: { ok: true, reasons: [] }
          }
        }
      ]
    }),
    "export.json"
  );
  assert.equal(snap.rows.BTCUSDT.symbol, "BTCUSDT");
  assert.equal(snap.rows.BTCUSDT.best.combo.rsiLen, 14);
  assert.equal(snap.config.chartTf, "5");
});

test("imports CSV exported by screener", () => {
  const csv = [
    "symbol,status,ok,rsiLen,osLevel,obLevel,maxStack,chartDays,netProfit,trainNet,testNet,testTrades,suitability,reasons,error",
    "ETHUSDT,done,yes,16,32,68,1,34.7,21.16,13.55,7.65,113,82,,"
  ].join("\n");
  const snap = parseImportFile(csv, "table.csv");
  assert.equal(snap.rows.ETHUSDT.symbol, "ETHUSDT");
  assert.equal(snap.rows.ETHUSDT.best.combo.rsiLen, 16);
  assert.equal(snap.rows.ETHUSDT.best.overview.netProfit, 21.16);
  assert.equal(snap.rows.ETHUSDT.best.test.closedTrades, 113);
  assert.equal(snap.rows.ETHUSDT.best.verdict.ok, true);
});
