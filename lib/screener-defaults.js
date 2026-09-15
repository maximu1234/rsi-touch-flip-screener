/** Только тикер Bybit/BingX linear, без пути в кэш. */
export function sanitizeScreenerSymbol(raw) {
  const symbol = String(raw || "")
    .replace(/\.P$/i, "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9]{2,40}$/.test(symbol)) {
    return "";
  }
  return symbol;
}

/** Интервал свечей Bybit: 1, 5, 60, D, W, M. */
export function sanitizeScreenerTf(raw, fallback = "") {
  const tf = String(raw ?? "").trim();
  if (!tf) {
    return fallback;
  }
  if (!/^[0-9]{1,4}$|^[DWM]$/i.test(tf)) {
    return fallback;
  }
  return /^[DWM]$/i.test(tf) ? tf.toUpperCase() : tf;
}

export function sanitizeScreenerExchange(raw) {
  return String(raw || "").toLowerCase() === "bingx" ? "bingx" : "bybit";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function csvEscape(cell) {
  let s = String(cell ?? "");
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export const DEFAULT_CONFIG = {
  exchange: "bybit",
  universe: "all",
  chartTf: "5",
  rsiTf: "1",
  tradeSide: "BOTH",
  budget: 30,
  sizeMode: "average",
  sizeMult: 1.5,
  commissionPct: 0.04,
  trainPct: 70,
  cycleSlEnabled: false,
  cycleSlPct: 30,
  compoundEnabled: false,
  chartPages: 10,
  workers: 2,
  fetchConcurrency: 2,
  symbols: [],
  comboLimit: 0,
  force: false,
  refreshCache: false,
  cacheMaxAgeHours: 12
};

export function normalizeConfig(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const universe =
    String(src.universe || DEFAULT_CONFIG.universe).toLowerCase() === "top100"
      ? "top100"
      : "all";
  const workers = Math.max(
    1,
    Math.min(8, Math.round(Number(src.workers) || DEFAULT_CONFIG.workers))
  );
  const fetchConcurrency = Math.max(
    1,
    Math.min(
      6,
      Math.round(Number(src.fetchConcurrency) || DEFAULT_CONFIG.fetchConcurrency)
    )
  );
  const symbols = Array.isArray(src.symbols)
    ? [...new Set(src.symbols.map((s) => sanitizeScreenerSymbol(s)).filter(Boolean))]
    : [];
  return {
    exchange: sanitizeScreenerExchange(src.exchange || DEFAULT_CONFIG.exchange),
    universe,
    chartTf: sanitizeScreenerTf(src.chartTf, DEFAULT_CONFIG.chartTf) || "5",
    rsiTf: sanitizeScreenerTf(
      src.rsiTf === undefined ? DEFAULT_CONFIG.rsiTf : src.rsiTf,
      ""
    ),
    tradeSide: String(src.tradeSide || DEFAULT_CONFIG.tradeSide).toUpperCase(),
    budget: Math.max(1, Number(src.budget) || DEFAULT_CONFIG.budget),
    sizeMode:
      String(src.sizeMode || DEFAULT_CONFIG.sizeMode).toLowerCase() === "equal"
        ? "equal"
        : "average",
    sizeMult: Math.max(1, Number(src.sizeMult) || DEFAULT_CONFIG.sizeMult),
    commissionPct: Math.max(
      0,
      Number.isFinite(Number(src.commissionPct))
        ? Number(src.commissionPct)
        : DEFAULT_CONFIG.commissionPct
    ),
    trainPct: Math.min(
      90,
      Math.max(50, Math.round(Number(src.trainPct) || DEFAULT_CONFIG.trainPct))
    ),
    cycleSlEnabled: src.cycleSlEnabled === true,
    cycleSlPct: Math.min(
      90,
      Math.max(1, Number(src.cycleSlPct) || DEFAULT_CONFIG.cycleSlPct)
    ),
    compoundEnabled: src.compoundEnabled === true,
    chartPages: Math.min(
      10,
      Math.max(1, Math.round(Number(src.chartPages) || DEFAULT_CONFIG.chartPages))
    ),
    workers,
    fetchConcurrency,
    symbols,
    comboLimit: Math.max(0, Math.round(Number(src.comboLimit) || 0)),
    force: src.force === true,
    refreshCache: src.refreshCache === true,
    cacheMaxAgeHours: Math.max(
      0,
      Number(src.cacheMaxAgeHours) || DEFAULT_CONFIG.cacheMaxAgeHours
    )
  };
}

export function configFingerprint(config) {
  const c = normalizeConfig({
    ...config,
    // СЛ цикла и Compound — оверлей на уже найденный набор, не новая сетка.
    cycleSlEnabled: false,
    cycleSlPct: 30,
    compoundEnabled: false
  });
  return [
    c.exchange,
    c.chartTf,
    c.rsiTf || "chart",
    c.tradeSide,
    c.budget,
    c.sizeMode,
    c.sizeMult,
    c.commissionPct,
    c.trainPct,
    c.cycleSlEnabled ? 1 : 0,
    c.cycleSlPct,
    c.compoundEnabled ? 1 : 0,
    c.chartPages,
    c.comboLimit
  ].join("|");
}

export function prefsFromConfig(config) {
  const c = normalizeConfig(config);
  return {
    rsiTf: c.rsiTf,
    tradeSide: c.tradeSide,
    budget: c.budget,
    sizeMode: c.sizeMode,
    sizeMult: c.sizeMult,
    commissionPct: c.commissionPct,
    cycleSlEnabled: c.cycleSlEnabled,
    cycleSlPct: c.cycleSlPct,
    compoundEnabled: c.compoundEnabled === true,
    showMarks: false,
    slippageTicks: 0
  };
}

export function gridPrefsFromConfig(config) {
  return {
    ...prefsFromConfig(config),
    cycleSlEnabled: false,
    compoundEnabled: false
  };
}
