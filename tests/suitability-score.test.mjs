import test from "node:test";
import assert from "node:assert/strict";
import {
  rsiTouchFlipSuitabilityDetail,
  formatSuitabilityTooltip
} from "../lib/suitability-score.js";

test("suitability tooltip lists verdict and weak test reasons", () => {
  const { score, reasons } = rsiTouchFlipSuitabilityDetail({
    best: {
      combo: { rsiLen: 14 },
      overview: {
        closedTrades: 12,
        profitFactor: 0.8,
        maxDrawdownPct: 35,
        chartDays: 20,
        grossProfit: 120,
        grossLoss: 1
      },
      train: { netProfit: 50 },
      test: { netProfit: -5, closedTrades: 3 },
      verdict: {
        ok: false,
        reasons: ["на Test мало сделок (3, нужно ≥ 8)", "Test не прибыльный"]
      }
    }
  });

  assert.ok(score != null && score <= 38);
  assert.match(formatSuitabilityTooltip(reasons), /Test не прибыльный/);
  assert.match(formatSuitabilityTooltip(reasons), /Мало сделок на всём графике/);
  assert.match(formatSuitabilityTooltip(reasons), /Большая просадка/);
});

test("suitability tooltip notes strong row", () => {
  const { reasons } = rsiTouchFlipSuitabilityDetail({
    best: {
      combo: { rsiLen: 14 },
      overview: {
        closedTrades: 120,
        profitFactor: 2.4,
        maxDrawdownPct: 8,
        chartDays: 60,
        grossProfit: 200,
        grossLoss: 80
      },
      train: { netProfit: 100 },
      test: { netProfit: 40, closedTrades: 12 },
      verdict: { ok: true, reasons: [] }
    }
  });

  const tip = formatSuitabilityTooltip(reasons);
  assert.match(tip, /Test прошёл проверку/);
  assert.match(tip, /Test в плюсе/);
  assert.match(tip, /Достаточно сделок/);
});
