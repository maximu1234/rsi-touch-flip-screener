import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { listRsiTouchFlipOptimizeCombos } from "../lib/rsi-touch-flip-optimize.js";
import {
  repaintFittedBest,
  snapshotFittedBest
} from "../lib/rsi-touch-flip-overlay.js";
import {
  configFingerprint,
  DEFAULT_CONFIG,
  gridPrefsFromConfig,
  normalizeConfig
} from "./defaults.js";
import { getExchange } from "./exchanges/index.js";
import {
  buildRsiForLen,
  sourceEndMs,
  sourcePagesForChart
} from "./rsi-prep.js";
import { rsiTouchFlipSuitabilityScore } from "../lib/suitability-score.js";
import { pickScanSymbols } from "./scan-resume.js";

const WORKER_PATH = fileURLToPath(new URL("./worker.js", import.meta.url));

function nowIso() {
  return new Date().toISOString();
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

function publicState(controller) {
  const rows = Object.values(controller.rows).sort((a, b) => {
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
  return {
    running: controller.running,
    paused: controller.paused,
    startedAt: controller.startedAt,
    stoppedAt: controller.stoppedAt,
    error: controller.error,
    config: controller.config,
    fingerprint: controller.fingerprint,
    progress: { ...controller.progress },
    log: controller.log.slice(-80),
    rows,
    counts: {
      total: controller.progress.total,
      done: controller.progress.done,
      queued: rows.filter((r) => r.status === "queued").length,
      running: rows.filter((r) => r.status === "running").length,
      ok: rows.filter((r) => r.best?.verdict?.ok).length,
      found: rows.filter((r) => r.best).length,
      errors: rows.filter((r) => r.error).length
    }
  };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf8");
  await rename(tmp, file);
}

export class ScanController {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.dataDir = path.join(rootDir, "data");
    this.resultsFile = path.join(this.dataDir, "results.json");
    this.listeners = new Set();
    this.running = false;
    this.paused = false;
    this.startedAt = null;
    this.stoppedAt = null;
    this.error = "";
    this.config = normalizeConfig(DEFAULT_CONFIG);
    this.fingerprint = configFingerprint(this.config);
    this.rows = {};
    this.log = [];
    this.progress = {
      phase: "idle",
      done: 0,
      total: 0,
      currentSymbol: "",
      comboDone: 0,
      comboTotal: 0
    };
    this.cancel = { cancelled: false };
    this.workers = [];
    this.overlayGen = 0;
    this.runId = 0;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(kind = "state") {
    const snap = publicState(this);
    for (const fn of this.listeners) {
      try {
        fn(kind, snap);
      } catch {
        /* ignore */
      }
    }
  }

  getState() {
    return publicState(this);
  }

  canResumeInterruptedScan() {
    if (this.running || this.paused || this.stoppedAt || !this.startedAt) {
      return false;
    }
    return Object.values(this.rows).some(
      (row) => row.status === "queued" || row.status === "running"
    );
  }

  note(message) {
    this.log.push({ at: nowIso(), message: String(message) });
    if (this.log.length > 200) {
      this.log.splice(0, this.log.length - 200);
    }
    this.emit();
  }

  async load() {
    const saved = await readJson(this.resultsFile, null);
    if (!saved || typeof saved !== "object") {
      return;
    }
    this.config = normalizeConfig(saved.config || DEFAULT_CONFIG);
    this.fingerprint = String(saved.fingerprint || configFingerprint(this.config));
    this.rows = saved.rows && typeof saved.rows === "object" ? saved.rows : {};
    this.startedAt = saved.startedAt || null;
    this.stoppedAt = saved.stoppedAt || null;
    this.paused = saved.paused === true || saved.progress?.phase === "paused";
    for (const row of Object.values(this.rows)) {
      if (row?.status === "running") {
        row.status = "queued";
      }
    }
    this.progress.done = Object.values(this.rows).filter((row) => isRowFinished(row)).length;
    this.progress.total = Number(saved.total) || Object.keys(this.rows).length;
    this.progress.phase = this.paused
      ? "paused"
      : this.rows && Object.keys(this.rows).length
        ? "saved"
        : "idle";
  }

  async persist() {
    await writeJsonAtomic(this.resultsFile, {
      fingerprint: this.fingerprint,
      config: this.config,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      paused: this.paused,
      total: this.progress.total,
      updatedAt: nowIso(),
      progress: { ...this.progress },
      rows: this.rows
    });
  }

  async importSnapshot(payload) {
    if (this.running) {
      throw new Error("Дождитесь окончания подбора");
    }
    const { normalizeImportPayload } = await import("../lib/import-results.js");
    const snap = normalizeImportPayload(payload);
    this.config = snap.config;
    this.fingerprint = snap.fingerprint;
    this.rows = snap.rows;
    this.startedAt = snap.startedAt || nowIso();
    this.stoppedAt = snap.stoppedAt || nowIso();
    this.progress.total = Object.keys(this.rows).length;
    this.progress.done = Object.values(this.rows).filter((row) => isRowFinished(row)).length;
    this.progress.phase = "saved";
    this.note(`Импорт: ${Object.keys(this.rows).length} тикеров`);
    await this.persist();
    this.emit();
    return this.getState();
  }

  cacheFile(exchange, symbol, tf) {
    return path.join(this.dataDir, "cache", exchange, symbol, `${tf}.json`);
  }

  async loadCache(exchange, symbol, tf, maxAgeHours, refresh) {
    if (refresh) {
      return null;
    }
    const saved = await readJson(this.cacheFile(exchange, symbol, tf), null);
    if (!saved?.candles?.length) {
      return null;
    }
    const ageMs = Date.now() - Number(saved.fetchedAt || 0);
    const maxMs = Math.max(0, Number(maxAgeHours) || 0) * 3600 * 1000;
    if (maxMs > 0 && ageMs > maxMs) {
      return null;
    }
    return saved.candles;
  }

  async saveCache(exchange, symbol, tf, candles) {
    await writeJsonAtomic(this.cacheFile(exchange, symbol, tf), {
      exchange,
      symbol,
      tf,
      fetchedAt: Date.now(),
      candles
    });
  }

  async resolveUniverse(config) {
    const exchange = getExchange(config.exchange);
    if (config.symbols.length) {
      return [...new Set(config.symbols)];
    }
    this.progress.phase = "listing";
    this.note(`Список инструментов ${config.exchange}…`);
    this.emit();
    const listed = await exchange.listLinearUsdtPerps();
    if (config.universe !== "top100") {
      return listed;
    }
    const turnover = await exchange.listTurnoverBySymbol();
    return listed
      .map((symbol) => ({ symbol, turnover: Number(turnover.get(symbol)) || 0 }))
      .sort((a, b) => b.turnover - a.turnover)
      .slice(0, 100)
      .map((row) => row.symbol);
  }

  async loadCachedHistory(symbol) {
    const exchange = this.config.exchange;
    const chartTf = this.config.chartTf;
    const rsiTf = this.config.rsiTf;
    const candles = await this.loadCache(exchange, symbol, chartTf, 0, false);
    if (!candles?.length) {
      return null;
    }
    let sourceCandles = [];
    if (rsiTf && rsiTf !== chartTf) {
      sourceCandles = await this.loadCache(exchange, symbol, rsiTf, 0, false);
    }
    return { candles, sourceCandles };
  }

  async paintRowBest(row, config = this.config) {
    if (!row?.best?.combo) {
      return row?.best || null;
    }
    const snapped = snapshotFittedBest(row.best);
    const cycleSl = config.cycleSlEnabled === true;
    const compound = config.compoundEnabled === true;
    if (!cycleSl && !compound) {
      return snapped?.fitted
        ? {
            ...snapped,
            overview: snapped.fitted.overview,
            train: snapped.fitted.train,
            test: snapped.fitted.test,
            verdict: snapped.fitted.verdict,
            prefs: snapped.fitted.prefs
          }
        : snapped;
    }
    const history = await this.loadCachedHistory(row.symbol);
    if (!history?.candles?.length) {
      return snapped;
    }
    const rsiValues = buildRsiForLen(
      history.candles,
      history.sourceCandles,
      config.chartTf,
      config.rsiTf,
      snapped.combo.rsiLen
    );
    return repaintFittedBest(snapped, {
      candles: history.candles,
      rsiValues,
      chartTf: config.chartTf,
      trainPct: config.trainPct,
      cycleSlEnabled: cycleSl,
      cycleSlPct: config.cycleSlPct,
      compoundEnabled: compound,
      basePrefs: gridPrefsFromConfig(config)
    });
  }

  paintWorkerBest(best, history) {
    const snapped = snapshotFittedBest(best);
    const cfg = this.config;
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

  async applyCycleSl(raw = {}) {
    const cycleSlEnabled = raw.cycleSlEnabled === true;
    const cycleSlPct = Math.min(
      90,
      Math.max(1, Number(raw.cycleSlPct) || this.config.cycleSlPct || 30)
    );
    const compoundEnabled = raw.compoundEnabled === true;
    this.config = normalizeConfig({
      ...this.config,
      cycleSlEnabled,
      cycleSlPct,
      compoundEnabled
    });
    this.overlayGen += 1;
    const gen = this.overlayGen;
    const symbols = Object.keys(this.rows).filter(
      (symbol) => this.rows[symbol]?.best?.combo
    );
    const overlayParts = [];
    if (cycleSlEnabled) {
      overlayParts.push(`СЛ ${cycleSlPct}%`);
    }
    if (compoundEnabled) {
      overlayParts.push("Compound");
    }
    this.note(
      overlayParts.length
        ? `${overlayParts.join(" + ")}: пересчёт ${symbols.length} готовых тикеров (наборы те же).`
        : "Оверлей выключен: цифры без СЛ и без compound."
    );
    this.emit("state");
    let done = 0;
    let changed = 0;
    for (const symbol of symbols) {
      if (gen !== this.overlayGen) {
        return;
      }
      const row = this.rows[symbol];
      const prevNet = Number(row.best?.overview?.netProfit);
      const painted = await this.paintRowBest(row, this.config);
      const nextNet = Number(painted?.overview?.netProfit);
      if (
        Number.isFinite(prevNet) &&
        Number.isFinite(nextNet) &&
        Math.abs(nextNet - prevNet) > 1e-9
      ) {
        changed += 1;
      }
      this.rows[symbol] = {
        ...row,
        best: painted,
        updatedAt: nowIso()
      };
      done += 1;
      if (done % 6 === 0) {
        this.emit("state");
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    await this.persist();
    this.note(
      overlayParts.length
        ? `${overlayParts.join(" + ")}: изменились ${changed} из ${done} тикеров.`
        : `Оверлей выключен: вернул ${changed} из ${done} тикеров.`
    );
    this.emit("state");
  }

  async loadHistory(config, symbol) {
    const exchange = getExchange(config.exchange);
    let candles = await this.loadCache(
      config.exchange,
      symbol,
      config.chartTf,
      config.cacheMaxAgeHours,
      config.refreshCache
    );
    if (!candles) {
      candles = await exchange.fetchKlinePages(
        symbol,
        config.chartTf,
        config.chartPages
      );
      await this.saveCache(config.exchange, symbol, config.chartTf, candles);
    }
    let sourceCandles = [];
    const rsiTf = config.rsiTf;
    if (rsiTf && rsiTf !== config.chartTf) {
      sourceCandles = await this.loadCache(
        config.exchange,
        symbol,
        rsiTf,
        config.cacheMaxAgeHours,
        config.refreshCache
      );
      if (!sourceCandles) {
        const pages = sourcePagesForChart(candles, config.chartTf, rsiTf, 21);
        sourceCandles = await exchange.fetchKlinePages(
          symbol,
          rsiTf,
          pages,
          sourceEndMs(candles, config.chartTf)
        );
        await this.saveCache(config.exchange, symbol, rsiTf, sourceCandles);
      }
    }
    return { candles, sourceCandles };
  }

  spawnWorker() {
    const worker = new Worker(WORKER_PATH);
    this.workers.push(worker);
    return worker;
  }

  killWorkers() {
    for (const worker of this.workers) {
      try {
        worker.postMessage({ type: "cancel" });
      } catch {
        /* ignore */
      }
      worker.terminate().catch(() => {});
    }
    this.workers = [];
  }

  runOnWorker(worker, payload, onProgress) {
    return new Promise((resolve, reject) => {
      const onMsg = (msg) => {
        if (msg?.type === "progress") {
          onProgress(msg);
          return;
        }
        if (msg?.type === "done") {
          worker.off("message", onMsg);
          worker.off("error", onErr);
          resolve(msg);
          return;
        }
        if (msg?.type === "error") {
          worker.off("message", onMsg);
          worker.off("error", onErr);
          reject(new Error(msg.message || "worker error"));
        }
      };
      const onErr = (err) => {
        worker.off("message", onMsg);
        worker.off("error", onErr);
        reject(err);
      };
      worker.on("message", onMsg);
      worker.on("error", onErr);
      worker.postMessage({ type: "run", ...payload });
    });
  }

  async start(rawConfig = {}) {
    if (this.running) {
      throw new Error("Подбор уже идёт");
    }
    const myId = ++this.runId;
    const stillThisRun = () => myId === this.runId;
    const config = normalizeConfig(rawConfig);
    const prevConfig = this.config;
    const prevRows = this.rows;
    const fingerprint = configFingerprint(config);
    const resuming =
      fingerprint === this.fingerprint &&
      (this.paused ||
        Object.values(this.rows).some(
          (row) => row.status === "queued" || row.status === "running"
        ));
    this.config = config;
    this.error = "";
    this.cancel = { cancelled: false };
    this.paused = false;
    this.running = true;
    if (!resuming || !this.startedAt) {
      this.startedAt = nowIso();
    }
    this.stoppedAt = null;

    if (fingerprint !== this.fingerprint) {
      this.note("Настройки изменились — предыдущая таблица сброшена.");
      this.rows = {};
      this.fingerprint = fingerprint;
    } else if (config.force) {
      this.note("Принудительный пересчёт: старые строки тикеров будут перезаписаны.");
    }

    this.progress = {
      phase: "starting",
      done: Object.keys(this.rows).length,
      total: 0,
      currentSymbol: "",
      comboDone: 0,
      comboTotal: 0
    };
    this.note(resuming ? "Продолжение подбора…" : "Старт подбора…");

    try {
      await this.runScan(config, { resuming, prevConfig, prevRows, myId });
      if (!stillThisRun()) {
        return;
      }
      if (this.paused) {
        this.progress.phase = "paused";
        this.note("На паузе. Когда будете на месте — нажмите Продолжить.");
      } else if (this.cancel.cancelled) {
        this.progress.phase = "stopped";
        this.note("Остановлено.");
      } else {
        this.progress.phase = "done";
        this.note("Готово.");
      }
    } catch (err) {
      if (!stillThisRun()) {
        return;
      }
      this.error = err?.message || String(err);
      this.progress.phase = "error";
      this.note(`Ошибка: ${this.error}`);
      throw err;
    } finally {
      if (!stillThisRun()) {
        return;
      }
      this.running = false;
      this.stoppedAt = nowIso();
      this.killWorkers();
      await this.persist();
      this.emit();
    }
  }

  pause() {
    if (!this.running) {
      return;
    }
    this.paused = true;
    this.cancel.cancelled = true;
    for (const worker of this.workers) {
      try {
        worker.postMessage({ type: "cancel" });
      } catch {
        /* ignore */
      }
    }
    this.note("Пауза…");
    this.emit();
  }

  stop() {
    this.pause();
  }

  async reset() {
    this.runId += 1;
    this.cancel = { cancelled: true };
    this.paused = false;
    this.running = false;
    this.error = "";
    this.killWorkers();
    this.rows = {};
    this.log = [];
    this.fingerprint = "";
    this.startedAt = null;
    this.stoppedAt = null;
    this.progress = {
      phase: "idle",
      done: 0,
      total: 0,
      currentSymbol: "",
      comboDone: 0,
      comboTotal: 0
    };
    this.overlayGen += 1;
    this.note("Таблица и подбор сброшены.");
    await this.persist();
    this.emit();
    return this.getState();
  }

  async runScan(config, resume = {}) {
    let symbols = pickScanSymbols(
      config,
      resume.prevConfig,
      resume.prevRows,
      resume.resuming
    );
    if (!symbols) {
      try {
        symbols = await this.resolveUniverse(config);
      } catch (err) {
        const fallback = pickScanSymbols(
          { symbols: [] },
          resume.prevConfig,
          resume.prevRows,
          true
        );
        if (!fallback?.length) {
          throw err;
        }
        this.note(
          "Список тикеров с биржи недоступен — продолжаю сохранённую очередь."
        );
        symbols = fallback;
      }
    }
    if (resume.myId != null && resume.myId !== this.runId) {
      return;
    }
    if (config.force) {
      this.rows = {};
    }
    for (const symbol of symbols) {
      const prev = this.rows[symbol];
      if (!prev || config.force) {
        this.rows[symbol] = {
          symbol,
          status: "queued",
          updatedAt: nowIso()
        };
      } else if (prev.status === "running") {
        prev.status = "queued";
      }
    }
    const pending = symbols.filter((symbol) => !isRowComplete(this.rows[symbol]));
    this.progress.total = symbols.length;
    this.progress.done = symbols.length - pending.length;
    this.progress.phase = "scan";
    const comboCount =
      config.comboLimit > 0
        ? config.comboLimit
        : listRsiTouchFlipOptimizeCombos().length;
    this.note(
      `Тикеров: ${symbols.length}. К подбору: ${pending.length}` +
        (this.progress.done ? `, уже есть: ${this.progress.done}` : "") +
        `. Сетка: ${comboCount} комбинаций.`
    );
    if (resume.myId != null && resume.myId !== this.runId) {
      return;
    }
    await this.persist();
    if (!pending.length) {
      return;
    }

    const combos = listRsiTouchFlipOptimizeCombos();
    const usedCombos =
      config.comboLimit > 0 ? combos.slice(0, config.comboLimit) : combos;
    const basePrefs = gridPrefsFromConfig(config);
    const queue = pending.slice();
    const limitFetch = createLimiter(config.fetchConcurrency);
    const workerCount = Math.min(config.workers, pending.length);
    const workers = Array.from({ length: workerCount }, () => this.spawnWorker());

    const saveRow = async (row) => {
      if (resume.myId != null && resume.myId !== this.runId) {
        return;
      }
      this.rows[row.symbol] = row;
      this.progress.done = symbols.filter((s) => isRowFinished(this.rows[s])).length;
      await this.persist();
      this.emit("state");
    };

    const runWorkerLoop = async (worker) => {
      while (
        !this.cancel.cancelled &&
        (resume.myId == null || resume.myId === this.runId)
      ) {
        const symbol = queue.shift();
        if (!symbol) {
          return;
        }
        this.progress.currentSymbol = symbol;
        this.progress.comboDone = 0;
        this.progress.comboTotal = usedCombos.length;
        this.rows[symbol] = {
          ...(this.rows[symbol] || { symbol }),
          status: "running",
          updatedAt: nowIso()
        };
        this.emit("state");

        let history;
        try {
          history = await limitFetch(() => this.loadHistory(config, symbol));
        } catch (err) {
          this.note(`${symbol}: ${err?.message || err}`);
          await saveRow({
            symbol,
            status: "error",
            error: err?.message || String(err),
            updatedAt: nowIso()
          });
          continue;
        }

        if (this.cancel.cancelled) {
          this.rows[symbol] = {
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

        this.note(`${symbol}: подбор ${usedCombos.length} комбинаций…`);
        try {
          const result = await this.runOnWorker(
            worker,
            {
              symbol,
              candles: history.candles,
              sourceCandles: history.sourceCandles,
              chartTf: config.chartTf,
              rsiTf: config.rsiTf,
              basePrefs,
              trainPct: config.trainPct,
              combos: usedCombos
            },
            (p) => {
              this.progress.currentSymbol = p.symbol;
              this.progress.comboDone = p.done;
              this.progress.comboTotal = p.total;
              this.emit("progress");
            }
          );
          if (result.cancelled || this.cancel.cancelled) {
            this.rows[symbol] = {
              symbol,
              status: "queued",
              updatedAt: nowIso()
            };
            this.note(`${symbol}: прервано, строка не сохранена.`);
            return;
          }
          const net = result.best?.overview?.netProfit;
          const best = this.paintWorkerBest(result.best, history);
          const verdict = best?.verdict?.ok ? "можно" : "нельзя";
          const shownNet = best?.overview?.netProfit ?? net;
          const overviewNote = best?.overviewBest?.combo
            ? `; макс. Обзор RSI ${best.overviewBest.combo.rsiLen} OS ${best.overviewBest.combo.osLevel} OB ${best.overviewBest.combo.obLevel} стек ${best.overviewBest.combo.maxStack} — Test красный`
            : "";
          this.note(
            best
              ? `${symbol}: ${verdict}, чистая ${Number(shownNet).toFixed(2)}${overviewNote}`
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
          this.note(`${symbol}: ${err?.message || err}`);
          await saveRow({
            symbol,
            status: "error",
            error: err?.message || String(err),
            updatedAt: nowIso()
          });
        }
      }
    };

    await Promise.all(workers.map((worker) => runWorkerLoop(worker)));
    if (this.cancel.cancelled) {
      for (const row of Object.values(this.rows)) {
        if (row?.status === "running") {
          row.status = "queued";
          row.updatedAt = nowIso();
        }
      }
    }
  }

  toCsv() {
    const header = [
      "symbol",
      "status",
      "ok",
      "rsiLen",
      "osLevel",
      "obLevel",
      "maxStack",
      "chartDays",
      "netProfit",
      "netProfitPct",
      "longProfit",
      "longProfitPct",
      "shortProfit",
      "shortProfitPct",
      "grossProfit",
      "grossProfitPct",
      "grossLoss",
      "grossLossPct",
      "closedTrades",
      "percentProfitable",
      "profitFactor",
      "maxDrawdown",
      "maxDrawdownPct",
      "maxTradeMae",
      "maxTradeMaePct",
      "liquidations",
      "avgTrade",
      "avgTradePct",
      "avgBars",
      "trainNet",
      "testNet",
      "testTrades",
      "suitability",
      "reasons",
      "error"
    ];
    const lines = [header.join(",")];
    const rows = publicState(this).rows;
    for (const row of rows) {
      const o = row.best?.overview || {};
      const c = row.best?.combo || {};
      const v = row.best?.verdict || {};
      const cells = [
        row.symbol,
        row.status || (row.error ? "error" : row.best ? "done" : "queued"),
        v.ok === true ? "yes" : v.ok === false ? "no" : "",
        c.rsiLen ?? "",
        c.osLevel ?? "",
        c.obLevel ?? "",
        c.maxStack ?? "",
        o.chartDays ?? "",
        o.netProfit ?? "",
        o.netProfitPct ?? "",
        o.longProfit ?? "",
        o.longProfitPct ?? "",
        o.shortProfit ?? "",
        o.shortProfitPct ?? "",
        o.grossProfit ?? "",
        o.grossProfitPct ?? "",
        o.grossLoss ?? "",
        o.grossLossPct ?? "",
        o.closedTrades ?? "",
        o.percentProfitable ?? "",
        o.profitFactor ?? "",
        o.maxDrawdown ?? "",
        o.maxDrawdownPct ?? "",
        o.maxTradeMae ?? "",
        o.maxTradeMaePct ?? "",
        o.liquidations ?? "",
        o.avgTrade ?? "",
        o.avgTradePct ?? "",
        o.avgBars ?? "",
        row.best?.train?.netProfit ?? "",
        row.best?.test?.netProfit ?? "",
        row.best?.test?.closedTrades ?? "",
        rsiTouchFlipSuitabilityScore(row) ?? "",
        (v.reasons || []).join("; "),
        row.error || row.note || ""
      ];
      lines.push(
        cells
          .map((cell) => {
            const s = String(cell);
            return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
          })
          .join(",")
      );
    }
    return lines.join("\n") + "\n";
  }

  toJson() {
    const snap = publicState(this);
    return {
      exportedAt: nowIso(),
      exchange: snap.config?.exchange,
      config: snap.config,
      counts: snap.counts,
      rows: snap.rows
    };
  }

  exportBasename() {
    const exchange = String(this.config?.exchange || "bybit");
    const day = nowIso().slice(0, 10);
    return `rsi-touch-flip-${exchange}-${day}`;
  }
}
