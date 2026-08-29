import { listRsiTouchFlipOptimizeCombos } from "../lib/rsi-touch-flip-optimize.js";
import {
  repaintFittedBest,
  snapshotFittedBest
} from "../lib/rsi-touch-flip-overlay.js";
import {
  fetchKlinePages,
  listLinearUsdtPerps,
  listTurnoverBySymbol
} from "./bybit.js";
import {
  configFingerprint,
  gridPrefsFromConfig,
  normalizeConfig
} from "./defaults.js";
import { downloadText, exportBasename, rowsToCsv } from "./export.js";
import {
  loadCachedKlines,
  loadSavedResults,
  saveCachedKlines,
  saveSavedResults
} from "./idb.js";
import { sourceEndMs, sourcePagesForChart, buildRsiForLen } from "./rsi-prep.js";

function nowIso() {
  return new Date().toISOString();
}

function isRowComplete(row) {
  if (!row) {
    return false;
  }
  if (row.error) {
    return false;
  }
  if (row.status === "queued" || row.status === "running") {
    return false;
  }
  return row.status === "done" || row.best != null || Boolean(row.note);
}

function isRowFinished(row) {
  return isRowComplete(row) || Boolean(row?.error);
}

function rowRank(row) {
  if (row?.best) {
    return 0;
  }
  if (row?.status === "running") {
    return 1;
  }
  if (row?.error) {
    return 2;
  }
  return 3;
}

function sortRows(rows) {
  return Object.values(rows).sort((a, b) => {
    const rank = rowRank(a) - rowRank(b);
    if (rank !== 0) {
      return rank;
    }
    const an = Number(a.best?.overview?.netProfit);
    const bn = Number(b.best?.overview?.netProfit);
    const av = Number.isFinite(an) ? an : -Infinity;
    const bv = Number.isFinite(bn) ? bn : -Infinity;
    if (bv !== av) {
      return bv - av;
    }
    return String(a.symbol || "").localeCompare(String(b.symbol || ""));
  });
}

function createLimiter(max) {
  let active = 0;
  const queue = [];
  return async function limit(fn) {
    if (active >= max) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      const next = queue.shift();
      if (next) {
        next();
      }
    }
  };
}

const session = {
  running: false,
  cancel: false,
  workers: [],
  rows: {},
  config: normalizeConfig({}),
  fingerprint: "",
  startedAt: null,
  stoppedAt: null,
  log: [],
  overlayGen: 0,
  progress: {
    phase: "idle",
    done: 0,
    total: 0,
    currentSymbol: "",
    comboDone: 0,
    comboTotal: 0
  }
};

function publicState() {
  const rows = sortRows(session.rows);
  return {
    running: session.running,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    error: session.error || "",
    config: session.config,
    fingerprint: session.fingerprint,
    progress: { ...session.progress },
    log: session.log.slice(-80),
    rows,
    counts: {
      total: session.progress.total,
      done: session.progress.done,
      queued: rows.filter((r) => r.status === "queued").length,
      running: rows.filter((r) => r.status === "running").length,
      ok: rows.filter((r) => r.best?.verdict?.ok).length,
      found: rows.filter((r) => r.best).length,
      errors: rows.filter((r) => r.error).length
    }
  };
}

function note(message) {
  session.log.push({ at: nowIso(), message: String(message) });
  if (session.log.length > 200) {
    session.log.splice(0, session.log.length - 200);
  }
}

async function persist() {
  await saveSavedResults({
    fingerprint: session.fingerprint,
    config: session.config,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    total: session.progress.total,
    updatedAt: nowIso(),
    rows: session.rows,
    log: session.log.slice(-80)
  });
}

async function loadCachedHistory(config, symbol) {
  const chartKey = cacheKey(config.exchange, symbol, config.chartTf);
  const candles = await loadCachedKlines(chartKey, 0, false);
  if (!candles?.length) {
    return null;
  }
  let sourceCandles = [];
  const rsiTf = config.rsiTf;
  if (rsiTf && rsiTf !== config.chartTf) {
    const srcKey = cacheKey(config.exchange, symbol, rsiTf);
    sourceCandles = await loadCachedKlines(srcKey, 0, false);
  }
  return { candles, sourceCandles };
}

/** Свечи для оверлея: кэш → повторная загрузка с Bybit. */
async function loadHistoryForRepaint(config, symbol) {
  const cached = await loadCachedHistory(config, symbol);
  if (cached?.candles?.length) {
    return { history: cached, source: "cache" };
  }
  try {
    const history = await loadHistory(config, symbol);
    if (history?.candles?.length) {
      return { history, source: "fetch" };
    }
  } catch {
    /* ignore */
  }
  return { history: null, source: "miss" };
}

function rowsToMap(rows) {
  if (!rows) {
    return {};
  }
  if (!Array.isArray(rows)) {
    return { ...rows };
  }
  const out = {};
  for (const row of rows) {
    if (row?.symbol) {
      out[row.symbol] = row;
    }
  }
  return out;
}

/** Синхронизировать session с таблицей из localStorage / импорта. */
export function hydrateClientSession(snap = {}) {
  const rows = rowsToMap(snap.rows);
  if (!Object.keys(rows).length) {
    return false;
  }
  session.config = normalizeConfig({ ...session.config, ...(snap.config || {}) });
  session.fingerprint = String(
    snap.fingerprint || configFingerprint(session.config)
  );
  session.rows = rows;
  session.startedAt = snap.startedAt || session.startedAt;
  session.stoppedAt = snap.stoppedAt || session.stoppedAt;
  session.progress.total = Object.keys(rows).length;
  session.progress.done = Object.values(rows).filter(isRowFinished).length;
  session.progress.phase = "saved";
  return true;
}

function paintWorkerBest(best, history) {
  const snapped = snapshotFittedBest(best);
  const cfg = session.config;
  const needsRepaint = cfg.cycleSlEnabled || cfg.compoundEnabled;
  if (!needsRepaint || !snapped?.combo || !history?.candles?.length) {
    return snapped;
  }
  const rsiValues = buildRsiForLen(
    history.candles,
    history.sourceCandles,
    cfg.chartTf,
    cfg.rsiTf,
    snapped.combo.rsiLen
  );
  return repaintFittedBest(snapped, {
    candles: history.candles,
    rsiValues,
    chartTf: cfg.chartTf,
    trainPct: cfg.trainPct,
    cycleSlEnabled: cfg.cycleSlEnabled === true,
    cycleSlPct: cfg.cycleSlPct,
    compoundEnabled: cfg.compoundEnabled === true,
    basePrefs: gridPrefsFromConfig(cfg)
  });
}

async function repaintRowBest(row, config, limitFetch) {
  if (!row?.best?.combo) {
    return { best: row?.best || null, miss: false };
  }
  const snapped = snapshotFittedBest(row.best);
  const cycleSl = config.cycleSlEnabled === true;
  const compound = config.compoundEnabled === true;
  if (!cycleSl && !compound) {
    return {
      best: snapped?.fitted
        ? {
            ...snapped,
            overview: snapped.fitted.overview,
            train: snapped.fitted.train,
            test: snapped.fitted.test,
            verdict: snapped.fitted.verdict,
            prefs: snapped.fitted.prefs
          }
        : snapped,
      miss: false
    };
  }
  const load = limitFetch
    ? () => limitFetch(() => loadHistoryForRepaint(config, row.symbol))
    : () => loadHistoryForRepaint(config, row.symbol);
  const { history, source } = await load();
  if (!history?.candles?.length) {
    return { best: snapped, miss: true };
  }
  const rsiValues = buildRsiForLen(
    history.candles,
    history.sourceCandles,
    config.chartTf,
    config.rsiTf,
    snapped.combo.rsiLen
  );
  const painted = repaintFittedBest(snapped, {
    candles: history.candles,
    rsiValues,
    chartTf: config.chartTf,
    trainPct: config.trainPct,
    cycleSlEnabled: cycleSl,
    cycleSlPct: config.cycleSlPct,
    compoundEnabled: compound,
    basePrefs: gridPrefsFromConfig(config)
  });
  return { best: painted, miss: source === "miss" };
}

export async function applyClientCycleSl(raw = {}, onState) {
  const cycleSlEnabled = raw.cycleSlEnabled === true;
  const cycleSlPct = Math.min(
    90,
    Math.max(1, Number(raw.cycleSlPct) || session.config.cycleSlPct || 30)
  );
  const compoundEnabled = raw.compoundEnabled === true;
  session.config = normalizeConfig({
    ...session.config,
    ...raw,
    cycleSlEnabled,
    cycleSlPct,
    compoundEnabled
  });
  session.overlayGen += 1;
  const gen = session.overlayGen;
  const symbols = Object.keys(session.rows).filter(
    (symbol) => session.rows[symbol]?.best?.combo
  );
  const overlayParts = [];
  if (cycleSlEnabled) {
    overlayParts.push(`СЛ ${cycleSlPct}%`);
  }
  if (compoundEnabled) {
    overlayParts.push("Compound");
  }
  if (!symbols.length) {
    note("Оверлей: нет готовых строк — сначала завершите подбор или загрузите результат.");
    const snap = publicState();
    onState?.(snap);
    return snap;
  }
  note(
    overlayParts.length
      ? `${overlayParts.join(" + ")}: пересчёт ${symbols.length} тикеров…`
      : "Оверлей выключен: возврат к базовым цифрам…"
  );
  onState?.(publicState());
  const limitFetch = createLimiter(Math.min(3, session.config.fetchConcurrency || 2));
  let done = 0;
  let changed = 0;
  let missed = 0;
  for (const symbol of symbols) {
    if (gen !== session.overlayGen) {
      return publicState();
    }
    const row = session.rows[symbol];
    const prevNet = Number(row.best?.overview?.netProfit);
    const { best: painted, miss } = await repaintRowBest(
      row,
      session.config,
      limitFetch
    );
    if (miss) {
      missed += 1;
    }
    const nextNet = Number(painted?.overview?.netProfit);
    if (
      Number.isFinite(prevNet) &&
      Number.isFinite(nextNet) &&
      Math.abs(nextNet - prevNet) > 1e-9
    ) {
      changed += 1;
    }
    session.rows[symbol] = {
      ...row,
      best: painted,
      updatedAt: nowIso()
    };
    done += 1;
    if (done % 4 === 0) {
      onState?.(publicState());
    }
  }
  await persist();
  if (missed > 0) {
    note(
      `Не удалось пересчитать ${missed} тикеров (нет свечей). Запустите подбор заново или проверьте сеть.`
    );
  }
  note(
    overlayParts.length
      ? `${overlayParts.join(" + ")}: изменились ${changed} из ${done} тикеров.`
      : `Оверлей выключен: вернул ${changed} из ${done} тикеров.`
  );
  const snap = publicState();
  onState?.(snap);
  return snap;
}

export async function loadClientState() {
  const saved = await loadSavedResults();
  if (!saved?.rows) {
    return null;
  }
  hydrateClientSession(saved);
  session.log = Array.isArray(saved.log) ? saved.log : [];
  return publicState();
}

function cacheKey(exchange, symbol, tf) {
  return `${exchange}|${symbol}|${tf}`;
}

async function loadHistory(config, symbol) {
  const chartKey = cacheKey(config.exchange, symbol, config.chartTf);
  let candles = await loadCachedKlines(
    chartKey,
    config.cacheMaxAgeHours,
    config.refreshCache
  );
  if (!candles) {
    candles = await fetchKlinePages(symbol, config.chartTf, config.chartPages);
    await saveCachedKlines(chartKey, candles);
  }
  let sourceCandles = [];
  const rsiTf = config.rsiTf;
  if (rsiTf && rsiTf !== config.chartTf) {
    const srcKey = cacheKey(config.exchange, symbol, rsiTf);
    sourceCandles = await loadCachedKlines(
      srcKey,
      config.cacheMaxAgeHours,
      config.refreshCache
    );
    if (!sourceCandles) {
      const pages = sourcePagesForChart(candles, config.chartTf, rsiTf, 21);
      sourceCandles = await fetchKlinePages(
        symbol,
        rsiTf,
        pages,
        sourceEndMs(candles, config.chartTf)
      );
      await saveCachedKlines(srcKey, sourceCandles);
    }
  }
  return { candles, sourceCandles };
}

async function resolveUniverse(config) {
  if (config.symbols.length) {
    return [...new Set(config.symbols)];
  }
  const listed = await listLinearUsdtPerps();
  if (config.universe !== "top100") {
    return listed;
  }
  const turnover = await listTurnoverBySymbol();
  return listed
    .map((symbol) => ({ symbol, turnover: Number(turnover.get(symbol)) || 0 }))
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, 100)
    .map((row) => row.symbol);
}

function workerUrl() {
  return new URL("./fit-worker.js", import.meta.url);
}

function runOnWorker(worker, payload, onProgress) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const msg = ev.data;
      if (msg?.type === "progress") {
        onProgress(msg);
        return;
      }
      if (msg?.type === "done") {
        worker.removeEventListener("message", onMsg);
        worker.removeEventListener("error", onErr);
        resolve(msg);
        return;
      }
      if (msg?.type === "error") {
        worker.removeEventListener("message", onMsg);
        worker.removeEventListener("error", onErr);
        reject(new Error(msg.message || "worker error"));
      }
    };
    const onErr = (err) => {
      worker.removeEventListener("message", onMsg);
      worker.removeEventListener("error", onErr);
      reject(err);
    };
    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
    worker.postMessage({ type: "run", ...payload });
  });
}

function killWorkers() {
  for (const worker of session.workers) {
    try {
      worker.postMessage({ type: "cancel" });
    } catch {
      /* ignore */
    }
    worker.terminate();
  }
  session.workers = [];
}

export function stopClientScan() {
  if (!session.running) {
    return;
  }
  session.cancel = true;
  for (const worker of session.workers) {
    try {
      worker.postMessage({ type: "cancel" });
    } catch {
      /* ignore */
    }
  }
  note("Остановка…");
}

export function exportClientCsv() {
  const snap = publicState();
  downloadText(
    `${exportBasename(snap.config?.exchange)}.csv`,
    rowsToCsv(snap.rows),
    "text/csv;charset=utf-8"
  );
}

export function exportClientJson() {
  const snap = publicState();
  downloadText(
    `${exportBasename(snap.config?.exchange)}.json`,
    JSON.stringify(
      {
        exportedAt: nowIso(),
        exchange: snap.config?.exchange,
        config: snap.config,
        counts: snap.counts,
        rows: snap.rows
      },
      null,
      2
    ),
    "application/json"
  );
}

export async function importClientSnapshot(payload) {
  if (session.running) {
    throw new Error("Дождитесь окончания подбора");
  }
  const { normalizeImportPayload } = await import("../lib/import-results.js");
  const snap = normalizeImportPayload(payload);
  session.config = snap.config;
  session.fingerprint = snap.fingerprint;
  session.rows = snap.rows;
  session.startedAt = snap.startedAt || nowIso();
  session.stoppedAt = snap.stoppedAt || nowIso();
  session.progress.total = Object.keys(session.rows).length;
  session.progress.done = Object.values(session.rows).filter(isRowFinished).length;
  session.progress.phase = "saved";
  note(`Импорт: ${Object.keys(session.rows).length} тикеров`);
  await persist();
  return publicState();
}

export async function startClientScan(rawConfig, onState, onProgress) {
  if (session.running) {
    throw new Error("Подбор уже идёт");
  }
  const emit = (kind = "state") => {
    const snap = publicState();
    if (kind === "progress") {
      onProgress?.(snap);
    } else {
      onState?.(snap);
    }
  };

  const config = normalizeConfig(rawConfig);
  if (config.exchange !== "bybit") {
    throw new Error("BingX ещё не подключён. Сейчас работает только Bybit.");
  }
  const fingerprint = configFingerprint(config);
  session.config = config;
  session.error = "";
  session.cancel = false;
  session.running = true;
  session.startedAt = nowIso();
  session.stoppedAt = null;

  if (fingerprint !== session.fingerprint) {
    note("Настройки изменились — предыдущая таблица сброшена.");
    session.rows = {};
    session.fingerprint = fingerprint;
  } else if (config.force) {
    note("Принудительный пересчёт: старые строки тикеров будут перезаписаны.");
  }

  session.progress = {
    phase: "listing",
    done: 0,
    total: 0,
    currentSymbol: "",
    comboDone: 0,
    comboTotal: 0
  };
  note("Старт подбора в браузере…");
  emit();

  try {
    const symbols = await resolveUniverse(config);
    if (config.force) {
      session.rows = {};
    }
    for (const symbol of symbols) {
      const prev = session.rows[symbol];
      if (!prev || config.force) {
        session.rows[symbol] = {
          symbol,
          status: "queued",
          updatedAt: nowIso()
        };
      } else if (prev.status === "running") {
        prev.status = "queued";
      }
    }
    const pending = symbols.filter(
      (symbol) => !isRowComplete(session.rows[symbol])
    );
    session.progress.total = symbols.length;
    session.progress.done = symbols.length - pending.length;
    session.progress.phase = "scan";
    const comboCount =
      config.comboLimit > 0
        ? config.comboLimit
        : listRsiTouchFlipOptimizeCombos().length;
    note(
      `Тикеров: ${symbols.length}. К подбору: ${pending.length}` +
        (session.progress.done ? `, уже есть: ${session.progress.done}` : "") +
        `. Сетка: ${comboCount} комбинаций.`
    );
    await persist();
    emit();
    if (!pending.length) {
      session.progress.phase = "done";
      note("Готово.");
      return;
    }

    const basePrefs = gridPrefsFromConfig(config);
    const queue = pending.slice();
    const limitFetch = createLimiter(config.fetchConcurrency);
    const workerCount = Math.min(config.workers, pending.length);
    session.workers = Array.from(
      { length: workerCount },
      () => new Worker(workerUrl(), { type: "module" })
    );

    const saveRow = async (row) => {
      session.rows[row.symbol] = row;
      session.progress.done = symbols.filter((s) =>
        isRowFinished(session.rows[s])
      ).length;
      await persist();
      emit("state");
    };

    const runWorkerLoop = async (worker) => {
      while (!session.cancel) {
        const symbol = queue.shift();
        if (!symbol) {
          return;
        }
        session.progress.currentSymbol = symbol;
        session.progress.comboDone = 0;
        session.progress.comboTotal = comboCount;
        session.rows[symbol] = {
          ...(session.rows[symbol] || { symbol }),
          status: "running",
          updatedAt: nowIso()
        };
        emit("state");

        let history;
        try {
          history = await limitFetch(() => loadHistory(config, symbol));
        } catch (err) {
          note(`${symbol}: ${err?.message || err}`);
          await saveRow({
            symbol,
            status: "error",
            error: err?.message || String(err),
            updatedAt: nowIso()
          });
          continue;
        }
        if (session.cancel) {
          session.rows[symbol] = {
            symbol,
            status: "queued",
            updatedAt: nowIso()
          };
          return;
        }
        if (!history.candles?.length) {
          await saveRow({
            symbol,
            status: "error",
            error: "нет свечей",
            updatedAt: nowIso()
          });
          continue;
        }

        note(`${symbol}: подбор ${comboCount} комбинаций…`);
        try {
          const result = await runOnWorker(
            worker,
            {
              symbol,
              candles: history.candles,
              sourceCandles: history.sourceCandles,
              chartTf: config.chartTf,
              rsiTf: config.rsiTf,
              basePrefs,
              trainPct: config.trainPct,
              comboLimit: config.comboLimit
            },
            (p) => {
              session.progress.currentSymbol = p.symbol;
              session.progress.comboDone = p.done;
              session.progress.comboTotal = p.total;
              emit("progress");
            }
          );
          if (result.cancelled || session.cancel) {
            session.rows[symbol] = {
              symbol,
              status: "queued",
              updatedAt: nowIso()
            };
            note(`${symbol}: прервано, строка не сохранена.`);
            return;
          }
          const net = result.best?.overview?.netProfit;
          const best = paintWorkerBest(result.best, history);
          const verdict = best?.verdict?.ok ? "можно" : "нельзя";
          const shownNet = best?.overview?.netProfit ?? net;
          note(
            best
              ? `${symbol}: ${verdict}, чистая ${Number(shownNet).toFixed(2)}`
              : `${symbol}: набор не найден`
          );
          await saveRow({
            symbol,
            status: "done",
            candles: history.candles.length,
            sourceCandles: history.sourceCandles?.length || 0,
            best,
            split: result.split,
            tried: result.tried,
            total: result.total,
            note: best ? "" : "нет набора с ≥8 сделками на Train",
            updatedAt: nowIso()
          });
        } catch (err) {
          note(`${symbol}: ${err?.message || err}`);
          await saveRow({
            symbol,
            status: "error",
            error: err?.message || String(err),
            updatedAt: nowIso()
          });
        }
      }
    };

    await Promise.all(session.workers.map((worker) => runWorkerLoop(worker)));
    session.progress.phase = session.cancel ? "stopped" : "done";
    note(session.cancel ? "Остановлено." : "Готово.");
  } catch (err) {
    session.error = err?.message || String(err);
    session.progress.phase = "error";
    note(`Ошибка: ${session.error}`);
    throw err;
  } finally {
    session.running = false;
    session.stoppedAt = nowIso();
    killWorkers();
    await persist();
    emit("state");
  }
}
