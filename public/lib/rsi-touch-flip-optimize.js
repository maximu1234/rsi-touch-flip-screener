/**
 * Сетка RSI Touch Flip: победитель — чистая прибыль на всём графике (Обзор).
 * Train/Test считаются отдельно: решение, включать ли тикер в бота.
 */
import {
  runRsiTouchFlip
} from "./rsi-touch-flip-engine.js";
import {
  normalizeRsiTouchFlipPrefs
} from "./rsi-touch-flip-prefs.js";
import {
  rsiTouchFlipMinTestTrades,
  rsiTouchFlipTestVerdict,
  rsiTouchFlipTrainTestSplit
} from "./rsi-touch-flip-walkforward.js";

export function rsiTouchFlipIntRange(from, to) {
  const start = Math.round(Number(from));
  const end = Math.round(Number(to));
  const out = [];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return out;
  }
  for (let i = start; i <= end; i++) {
    out.push(i);
  }
  return out;
}

/** RSI 5..21, OS 15..35, OB 65..85, стек 1..10 — все целые, без пропусков. */
export const RSI_TOUCH_FLIP_LEN_GRID = rsiTouchFlipIntRange(5, 21);
export const RSI_TOUCH_FLIP_OS_GRID = rsiTouchFlipIntRange(15, 35);
export const RSI_TOUCH_FLIP_OB_GRID = rsiTouchFlipIntRange(65, 85);
export const RSI_TOUCH_FLIP_STACK_GRID = rsiTouchFlipIntRange(1, 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @returns {Array<{ rsiLen: number, osLevel: number, obLevel: number, maxStack: number }>}
 */
export function listRsiTouchFlipOptimizeCombos() {
  const out = [];
  for (const rsiLen of RSI_TOUCH_FLIP_LEN_GRID) {
    for (const osLevel of RSI_TOUCH_FLIP_OS_GRID) {
      for (const obLevel of RSI_TOUCH_FLIP_OB_GRID) {
        if (obLevel <= osLevel) {
          continue;
        }
        for (const maxStack of RSI_TOUCH_FLIP_STACK_GRID) {
          out.push({ rsiLen, osLevel, obLevel, maxStack });
        }
      }
    }
  }
  return out;
}

/**
 * Ранг ячейки сетки: только чистая прибыль (netProfit = сумма pnl сделок
 * после комиссии). Валовая (grossProfit), профит-фактор и число сделок
 * не перебивают чистую.
 * @param {object|null|undefined} overview
 * @returns {number}
 */
export function scoreRsiTouchFlipNetOverview(overview) {
  const closed = Number(overview?.closedTrades);
  if (!Number.isFinite(closed) || closed <= 0) {
    return -Infinity;
  }
  const net = Number(overview?.netProfit);
  if (!Number.isFinite(net)) {
    return -Infinity;
  }
  const dd = Number(overview?.maxDrawdownPct);
  const ddPart = Number.isFinite(dd) ? dd : 100;
  return net * 1e9 - ddPart;
}

/**
 * @param {object|null|undefined} overview
 * @returns {number}
 */
export function scoreRsiTouchFlipTrainOverview(overview) {
  return scoreRsiTouchFlipNetOverview(overview);
}

/**
 * @param {object|null|undefined} a
 * @param {object|null|undefined} b
 * @returns {boolean}
 */
export function isBetterRsiTouchFlipTrain(a, b) {
  if (!a) {
    return false;
  }
  const closed = Number(a.closedTrades);
  if (!Number.isFinite(closed) || closed <= 0) {
    return false;
  }
  if (!b) {
    return true;
  }
  return scoreRsiTouchFlipTrainOverview(a) > scoreRsiTouchFlipTrainOverview(b);
}

/**
 * @param {object|null|undefined} overview
 * @returns {number}
 */
export function scoreRsiTouchFlipTestOverview(overview) {
  return scoreRsiTouchFlipNetOverview(overview);
}

/**
 * Лучший набор сетки: максимум чистой на всём графике (Обзор).
 * Test не участвует в ранге — он только для «включать ли тикер в бота».
 * @param {object|null|undefined} a
 * @param {object|null|undefined} b
 * @returns {boolean}
 */
export function isBetterRsiTouchFlipLaunch(a, b) {
  if (!a?.overview) {
    return false;
  }
  const closed = Number(a.overview.closedTrades);
  if (!Number.isFinite(closed) || closed <= 0) {
    return false;
  }
  if (!b?.overview) {
    return true;
  }
  return scoreRsiTouchFlipNetOverview(a.overview) >
    scoreRsiTouchFlipNetOverview(b.overview);
}

function pickOverview(overview) {
  if (!overview || typeof overview !== "object") {
    return null;
  }
  return {
    netProfit: overview.netProfit,
    netProfitPct: overview.netProfitPct,
    longProfit: overview.longProfit,
    longProfitPct: overview.longProfitPct,
    shortProfit: overview.shortProfit,
    shortProfitPct: overview.shortProfitPct,
    grossProfit: overview.grossProfit,
    grossProfitPct: overview.grossProfitPct,
    grossLoss: overview.grossLoss,
    grossLossPct: overview.grossLossPct,
    closedTrades: overview.closedTrades,
    percentProfitable: overview.percentProfitable,
    profitFactor: overview.profitFactor,
    maxDrawdown: overview.maxDrawdown,
    maxDrawdownPct: overview.maxDrawdownPct,
    maxTradeMae: overview.maxTradeMae,
    maxTradeMaePct: overview.maxTradeMaePct,
    liquidations: overview.liquidations,
    avgTrade: overview.avgTrade,
    avgTradePct: overview.avgTradePct,
    avgBars: overview.avgBars,
    chartDays: overview.chartDays
  };
}

export function compactRsiTouchFlipOverview(overview) {
  if (!overview) {
    return null;
  }
  const o = pickOverview(overview) || overview;
  return {
    ...o,
    profitFactor:
      o.profitFactor === Infinity ? "Infinity" : o.profitFactor
  };
}

/**
 * Один прогон Train / Test / Обзор для уже найденного набора.
 * Нужен, чтобы чек-бокс СЛ цикла менял цифры в таблице без нового перебора сетки.
 */
export function evaluateRsiTouchFlipCombo(opts = {}) {
  const candles = Array.isArray(opts.candles) ? opts.candles : [];
  const rsiValues = Array.isArray(opts.rsiValues) ? opts.rsiValues : [];
  if (!candles.length || rsiValues.length !== candles.length) {
    return null;
  }
  const prefs = normalizeRsiTouchFlipPrefs(opts.prefs);
  const chartTf = String(opts.chartTf || "").trim();
  const split = rsiTouchFlipTrainTestSplit(
    candles,
    rsiValues,
    chartTf,
    opts.trainPct
  );
  if (!split) {
    return null;
  }
  const train = compactRsiTouchFlipOverview(
    runWindow(split.train, prefs, rsiValues)
  );
  const test = compactRsiTouchFlipOverview(
    runWindow(split.test, prefs, rsiValues)
  );
  const overview = compactRsiTouchFlipOverview(
    runFullChart(
      candles,
      prefs,
      rsiValues,
      (Number(split.train.days) || 0) + (Number(split.test.days) || 0)
    )
  );
  return {
    prefs: {
      rsiLen: prefs.rsiLen,
      osLevel: prefs.osLevel,
      obLevel: prefs.obLevel,
      maxStack: prefs.maxStack,
      rsiTf: prefs.rsiTf,
      tradeSide: prefs.tradeSide,
      cycleSlEnabled: prefs.cycleSlEnabled === true,
      cycleSlPct: prefs.cycleSlPct
    },
    overview,
    train,
    test,
    verdict: rsiTouchFlipTestVerdict(test, {
      minTrades: rsiTouchFlipMinTestTrades(split.test.bars)
    })
  };
}

function runWindow(window, prefs, rsiFull) {
  const rsiValues = Array.isArray(rsiFull)
    ? rsiFull.slice(window.from, window.to)
    : window.rsiValues;
  const result = runRsiTouchFlip(window.candles, prefs, { rsiValues });
  return {
    ...pickOverview(result.overview),
    chartDays: window.days
  };
}

function runFullChart(candles, prefs, rsiFull, chartDays) {
  const result = runRsiTouchFlip(candles, prefs, { rsiValues: rsiFull });
  return {
    ...pickOverview(result.overview),
    chartDays
  };
}

/**
 * @param {{
 *   candles: Array,
 *   rsiByLen: Map<number, number[]>|Record<number, number[]>,
 *   basePrefs: object,
 *   chartTf: string,
 *   trainPct?: number,
 *   signal?: { cancelled?: boolean }|null,
 *   onProgress?: (p: { done: number, total: number }) => void,
 *   combos?: Array<{ rsiLen: number, osLevel: number, obLevel: number, maxStack: number }>,
 *   yieldEvery?: number
 * }} opts
 */
export async function optimizeRsiTouchFlipParams(opts = {}) {
  const candles = Array.isArray(opts.candles) ? opts.candles : [];
  const basePrefs = normalizeRsiTouchFlipPrefs(opts.basePrefs);
  const chartTf = String(opts.chartTf || "").trim();
  const trainPct = opts.trainPct;
  const signal = opts.signal || null;
  const onProgress =
    typeof opts.onProgress === "function" ? opts.onProgress : null;
  const yieldEveryRaw = Number(opts.yieldEvery);
  const yieldEvery =
    Number.isFinite(yieldEveryRaw) && yieldEveryRaw >= 0
      ? Math.floor(yieldEveryRaw)
      : 32;
  const rsiByLen =
    opts.rsiByLen instanceof Map
      ? opts.rsiByLen
      : new Map(
          Object.entries(opts.rsiByLen || {}).map(([k, v]) => [Number(k), v])
        );
  const combos =
    Array.isArray(opts.combos) && opts.combos.length
      ? opts.combos
      : listRsiTouchFlipOptimizeCombos();
  const split = rsiTouchFlipTrainTestSplit(
    candles,
    undefined,
    chartTf,
    trainPct
  );

      if (!split) {
    return {
      cancelled: false,
      best: null,
      bestTrain: null,
      tried: 0,
      total: combos.length,
      split: null
    };
  }

  const minTrainTrades = 8;
  let bestLaunch = null;
  let bestTrain = null;
  let tried = 0;

  for (const combo of combos) {
    if (signal?.cancelled) {
      return {
        cancelled: true,
        best: bestLaunch,
        bestTrain,
        tried,
        total: combos.length,
        split
      };
    }

    const rsiFull = rsiByLen.get(combo.rsiLen);
    if (!Array.isArray(rsiFull) || rsiFull.length !== candles.length) {
      tried += 1;
      continue;
    }

    const prefs = normalizeRsiTouchFlipPrefs({
      ...basePrefs,
      ...combo
    });
    const trainOverview = runWindow(split.train, prefs, rsiFull);
    tried += 1;

    if (Number(trainOverview.closedTrades) < minTrainTrades) {
      if (onProgress) {
        onProgress({ done: tried, total: combos.length });
      }
      if (yieldEvery > 0 && tried % yieldEvery === 0) {
        await sleep(0);
      }
      continue;
    }

    const testOverview = runWindow(split.test, prefs, rsiFull);
    const verdict = rsiTouchFlipTestVerdict(testOverview, {
      minTrades: rsiTouchFlipMinTestTrades(split.test.bars)
    });
    const overview = runFullChart(
      candles,
      prefs,
      rsiFull,
      (Number(split.train.days) || 0) + (Number(split.test.days) || 0)
    );
    const row = {
      combo,
      prefs,
      train: trainOverview,
      test: testOverview,
      overview,
      verdict
    };

    if (isBetterRsiTouchFlipTrain(trainOverview, bestTrain?.train)) {
      bestTrain = row;
    }
    if (isBetterRsiTouchFlipLaunch(row, bestLaunch)) {
      bestLaunch = row;
    }

    if (onProgress) {
      onProgress({ done: tried, total: combos.length });
    }
    if (yieldEvery > 0 && tried % yieldEvery === 0) {
      await sleep(0);
    }
  }

  return {
    cancelled: false,
    best: bestLaunch,
    bestTrain,
    tried,
    total: combos.length,
    split
  };
}
