/**
 * Нарезка Train / Test для RSI Touch Flip.
 * В бота — максимум чистой Обзора среди наборов с зелёным Test.
 * Чемпион всего Обзора с красным Test — только справка.
 */
import {
  rsiTouchFlipChartDays
} from "./rsi-touch-flip-mtf.js";
import {
  RSI_TOUCH_FLIP_TF_OPTIONS
} from "./rsi-touch-flip-prefs.js";

export const RSI_TOUCH_FLIP_DEFAULT_TRAIN_PCT = 70;

const TF_LABELS = Object.fromEntries(
  RSI_TOUCH_FLIP_TF_OPTIONS.map((opt) => [opt.value, opt.label])
);

/**
 * @param {unknown} raw
 * @returns {number}
 */
export function clampRsiTouchFlipTrainPct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return RSI_TOUCH_FLIP_DEFAULT_TRAIN_PCT;
  }
  return Math.min(90, Math.max(50, Math.round(n)));
}

/**
 * Индекс первой свечи Test. 0 — окно слишком короткое.
 * @param {number} length
 * @param {unknown} trainPct
 * @returns {number}
 */
export function rsiTouchFlipSplitIndex(length, trainPct) {
  const n = Math.floor(Number(length) || 0);
  const pct = clampRsiTouchFlipTrainPct(trainPct) / 100;
  if (n < 120) {
    return 0;
  }
  const split = Math.floor(n * pct);
  const testLen = n - split;
  if (split < 80 || testLen < 40) {
    return 0;
  }
  return split;
}

/**
 * @param {Array} candles
 * @param {number[]|undefined} rsiValues
 * @param {number} from
 * @param {number} to
 */
export function sliceRsiTouchFlipWindow(candles, rsiValues, from, to) {
  const rows = Array.isArray(candles) ? candles.slice(from, to) : [];
  const rsi = Array.isArray(rsiValues) ? rsiValues.slice(from, to) : undefined;
  return { candles: rows, rsiValues: rsi };
}

/**
 * @param {Array<{time:number}>} candles
 * @param {string} chartTf
 * @param {number} from
 * @param {number} to
 */
export function rsiTouchFlipWindowMeta(candles, chartTf, from, to) {
  const rows = Array.isArray(candles) ? candles.slice(from, to) : [];
  return {
    from,
    to,
    bars: rows.length,
    days: rsiTouchFlipChartDays(rows, chartTf)
  };
}

/**
 * @param {Array} candles
 * @param {number[]|undefined} rsiValues
 * @param {string} chartTf
 * @param {unknown} trainPct
 */
export function rsiTouchFlipTrainTestSplit(
  candles,
  rsiValues,
  chartTf,
  trainPct
) {
  const rows = Array.isArray(candles) ? candles : [];
  const split = rsiTouchFlipSplitIndex(rows.length, trainPct);
  if (!split) {
    return null;
  }
  return {
    splitIndex: split,
    trainPct: clampRsiTouchFlipTrainPct(trainPct),
    train: {
      ...sliceRsiTouchFlipWindow(rows, rsiValues, 0, split),
      ...rsiTouchFlipWindowMeta(rows, chartTf, 0, split)
    },
    test: {
      ...sliceRsiTouchFlipWindow(rows, rsiValues, split, rows.length),
      ...rsiTouchFlipWindowMeta(rows, chartTf, split, rows.length)
    }
  };
}

/**
 * @param {object} prefs
 * @returns {string}
 */
export function formatRsiTouchFlipParamsBrief(prefs) {
  if (!prefs || typeof prefs !== "object") {
    return "—";
  }
  const tfKey = String(prefs.rsiTf ?? "");
  const tfLabel = Object.prototype.hasOwnProperty.call(TF_LABELS, tfKey)
    ? TF_LABELS[tfKey]
    : "график";
  const parts = [
    `RSI ${prefs.rsiLen}`,
    `OS ${prefs.osLevel}`,
    `OB ${prefs.obLevel}`,
    `стек ${prefs.maxStack}`,
    `RSI ${tfLabel}`,
    prefs.tradeSide
  ];
  if (prefs.cycleSlEnabled === true) {
    parts.push(`СЛ ${prefs.cycleSlPct}%`);
  }
  return parts.join(" · ");
}

/**
 * @param {number} testBars
 * @returns {number}
 */
export function rsiTouchFlipMinTestTrades(testBars) {
  const n = Math.floor(Number(testBars) || 0);
  return Math.max(4, Math.min(8, Math.floor(n / 150) || 4));
}

/**
 * Test «зелёный»: прибыльный, достаточно сделок, PF ≥ 1.
 * Просадка в строке видна, но не вето — 25.7% vs 25% не должна
 * отбрасывать набор с плюсом на Test и большой чистой на всём графике.
 * @param {object|null|undefined} overview
 * @param {{ minTrades?: number, maxDdPct?: number }} [opts]
 */
export function rsiTouchFlipTestVerdict(overview, opts = {}) {
  const minTrades = Number.isFinite(opts.minTrades) ? opts.minTrades : 8;
  const reasons = [];
  const closed = Number(overview?.closedTrades);
  const net = Number(overview?.netProfit);
  const pfRaw = overview?.profitFactor;
  const pf =
    pfRaw === Infinity || pfRaw === "Infinity"
      ? Infinity
      : Number(pfRaw);
  const dd = Number(overview?.maxDrawdownPct);
  const maxDdPct = Number(opts.maxDdPct);

  if (!Number.isFinite(closed) || closed < minTrades) {
    reasons.push(
      `на Test мало сделок (${Number.isFinite(closed) ? closed : 0}, нужно ≥ ${minTrades})`
    );
  }
  if (!Number.isFinite(net) || !(net > 0)) {
    reasons.push("Test не прибыльный");
  }
  const pfOk =
    pf === Infinity || (Number.isFinite(pf) && pf >= 1);
  if (!pfOk) {
    reasons.push("профит-фактор Test < 1");
  }
  if (
    Number.isFinite(maxDdPct) &&
    Number.isFinite(dd) &&
    dd > maxDdPct
  ) {
    reasons.push(`просадка Test ${dd.toFixed(1)}% > ${maxDdPct}%`);
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * @param {{ ok: boolean, reasons: string[] }|null} verdict
 * @param {object|null} [trainOverview]
 * @param {object|null} [testOverview]
 * @param {{ currentPassesTest?: boolean }} [opts]
 */
export function rsiTouchFlipLaunchAdvice(
  verdict,
  trainOverview,
  testOverview,
  opts = {}
) {
  if (!verdict) {
    return {
      canLaunch: false,
      title: "Сначала подберите параметры",
      detail:
        "Сетка ищет максимум чистой среди наборов с зелёным Test — это в бота. Отдельно виден чемпион Обзора, если у него Test красный."
    };
  }
  if (verdict.ok) {
    return {
      canLaunch: true,
      title: "Запускать бота с этими параметрами",
      detail:
        "Лучшая чистая на всём графике среди наборов, где Test зелёный (сделки и PF). Это то, что можно ставить в бота."
    };
  }
  const trainNet = Number(trainOverview?.netProfit);
  const testNet = Number(testOverview?.netProfit);
  const fitted =
    Number.isFinite(trainNet) &&
    trainNet > 0 &&
    (!Number.isFinite(testNet) || !(testNet > 0));
  const why = (verdict.reasons || []).join("; ");
  const currentOk = opts.currentPassesTest === true;
  if (currentOk) {
    return {
      canLaunch: false,
      title: "Сетка не нашла набор лучше",
      detail:
        `Лучший по Обзору набор Test забраковал (${why}). ` +
        "Набора с зелёным Test, который обошёл поля слева, нет. В бота — то, что сейчас в полях слева."
    };
  }
  return {
    canLaunch: false,
    title: "В сетке нет набора для бота",
    detail: fitted
      ? `Макс. по Обзору Test красный (${why}). Среди ячеек с зелёным Test ничего не нашлось.`
      : `Набор с максимальной чистой на всём графике не проходит Test (${why || "Test не прошёл пороги."}). Зелёного набора в сетке нет.`
  };
}

/**
 * Подсказка, если чемпион Обзора отличается от торгуемого набора.
 * @param {object|null|undefined} overviewBest
 * @returns {string}
 */
export function formatRsiTouchFlipOverviewBestNote(overviewBest) {
  const prefs = overviewBest?.prefs || overviewBest?.combo;
  if (!prefs || overviewBest?.verdict?.ok === true) {
    return "";
  }
  return (
    `Макс. по Обзору RSI ${prefs.rsiLen} · OS ${prefs.osLevel} · OB ${prefs.obLevel} · стек ${prefs.maxStack} — Test красный, в бота не берём.`
  );
}
