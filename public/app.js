import {
  exportClientCsv,
  exportClientJson,
  hydrateClientSession,
  importClientSnapshot,
  loadClientState,
  pauseClientScan,
  resetClientScan,
  startClientScan,
  applyClientCycleSl,
  hasUnfinishedRows
} from "./client/scan-client.js?v=10";
import { parseImportFile } from "./lib/import-results.js";
import { formatRsiTouchFlipOverviewBestNote } from "./lib/rsi-touch-flip-walkforward.js";
import {
  rsiTouchFlipSuitabilityDetail,
  rsiTouchFlipSuitabilityScore,
  suitabilityBand,
  formatSuitabilityTooltip
} from "./lib/suitability-score.js";

const form = document.getElementById("form");
const tbody = document.getElementById("tbody");
const barFill = document.getElementById("bar-fill");
const statusLine = document.getElementById("status-line");
const countsEl = document.getElementById("counts");
const logEl = document.getElementById("log");
const filterEl = document.getElementById("filter");
const btnStart = document.getElementById("btn-start");
const btnPause = document.getElementById("btn-pause");
const btnReset = document.getElementById("btn-reset");
const btnSaved = document.getElementById("btn-saved");
const btnImport = document.getElementById("btn-import");
const importFile = document.getElementById("import-file");

const LOCAL_KEY = "rsi-touch-flip-screener-last-v1";

function isStaticPagesHost() {
  const host = String(location.hostname || "");
  return (
    location.protocol === "file:" ||
    host.endsWith("github.io") ||
    host.endsWith("pages.dev")
  );
}

async function detectBackend() {
  const query = new URLSearchParams(location.search);
  if (query.get("browser") === "1") {
    return false;
  }
  if (query.get("server") !== "1" && isStaticPagesHost()) {
    return false;
  }
  try {
    const res = await fetch("./api/state", {
      cache: "no-store",
      signal: AbortSignal.timeout(1500)
    });
    if (!res.ok) {
      return false;
    }
    const json = await res.json();
    return json && typeof json === "object" && ("running" in json || "rows" in json);
  } catch {
    return false;
  }
}

const useBackend = await detectBackend();

let state = { rows: [], progress: {}, running: false };
let sortKey = "netProfit";
let sortDir = "desc";
let lastRowStamp = "";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value, digits = 2) {
  const n = num(value);
  return n == null ? "—" : n.toFixed(digits);
}

function fmtPct(value) {
  const n = num(value);
  return n == null ? "" : ` (${n.toFixed(1)}%)`;
}

function cls(value) {
  const n = num(value);
  if (n == null) {
    return "";
  }
  return n > 0 ? "pos" : n < 0 ? "neg" : "";
}

function moneyCell(value, pct) {
  return `<td class="${cls(value)}">${fmt(value)}${fmtPct(pct)}</td>`;
}

function emptyCells(count) {
  return "<td>—</td>".repeat(count);
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function suitabilityCell(row) {
  const { score, reasons } = rsiTouchFlipSuitabilityDetail(row);
  if (score == null) {
    return "<td>—</td>";
  }
  const band = suitabilityBand(score);
  const tip = escapeAttr(formatSuitabilityTooltip(reasons));
  return `<td class="suitability suitability--${band}" title="${tip}">${score}%</td>`;
}

function sortValue(row, key) {
  const o = row.best?.overview || {};
  const c = row.best?.combo || {};
  switch (key) {
    case "symbol":
      return row.symbol || "";
    case "ok":
      if (row.best?.verdict?.ok) {
        return 2;
      }
      if (row.best) {
        return 1;
      }
      if (row.status === "running") {
        return 0;
      }
      return -1;
    case "rsiLen":
    case "osLevel":
    case "obLevel":
    case "maxStack":
      return num(c[key]) ?? -Infinity;
    case "trainNet":
      return num(row.best?.train?.netProfit) ?? -Infinity;
    case "testNet":
      return num(row.best?.test?.netProfit) ?? -Infinity;
    case "suitability":
      return rsiTouchFlipSuitabilityScore(row) ?? -Infinity;
    default:
      return num(o[key]) ?? -Infinity;
  }
}

function filteredRows() {
  const q = String(filterEl.value || "").trim().toLowerCase();
  let rows = state.rows || [];
  if (q === "можно") {
    rows = rows.filter((r) => r.best?.verdict?.ok);
  } else if (q === "нельзя") {
    rows = rows.filter((r) => r.best && !r.best.verdict?.ok);
  } else if (q === "ожидание") {
    rows = rows.filter((r) => r.status === "queued");
  } else if (q) {
    rows = rows.filter((r) => String(r.symbol || "").toLowerCase().includes(q));
  }
  const dir = sortDir === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = sortValue(a, sortKey);
    const bv = sortValue(b, sortKey);
    if (typeof av === "string" || typeof bv === "string") {
      const cmp = String(av).localeCompare(String(bv));
      return cmp === 0
        ? String(a.symbol).localeCompare(String(b.symbol))
        : cmp * dir;
    }
    if (av === bv) {
      return String(a.symbol).localeCompare(String(b.symbol));
    }
    return (av - bv) * dir;
  });
}

function renderTable() {
  const rows = filteredRows();
  tbody.innerHTML = rows
    .map((row) => {
      if (row.error) {
        return `<tr class="is-error"><td>${row.symbol}</td><td class="no">ошибка</td><td colspan="21">${row.error}</td></tr>`;
      }
      const o = row.best?.overview;
      const c = row.best?.combo;
      if (!c) {
        const label =
          row.status === "running"
            ? "считаем…"
            : row.status === "queued"
              ? "ожидание"
              : row.note || "нет набора";
        const kind =
          row.status === "running"
            ? "is-run"
            : row.status === "queued"
              ? "is-wait"
              : "";
        return `<tr class="${kind}"><td>${row.symbol}</td><td class="muted">${label}</td>${emptyCells(21)}</tr>`;
      }
      const ok = row.best?.verdict?.ok;
      const overviewNote = formatRsiTouchFlipOverviewBestNote(row.best?.overviewBest);
      const okTip = escapeAttr(
        overviewNote ||
          (ok
            ? "Лучшая чистая Обзора среди наборов с зелёным Test"
            : "В сетке нет набора с зелёным Test; показан максимум Обзора")
      );
      return `<tr>
        <td>${row.symbol}</td>
        <td class="${ok ? "ok" : "no"}" title="${okTip}">${ok ? "можно" : "нельзя"}</td>
        <td>${c.rsiLen}</td>
        <td>${c.osLevel}</td>
        <td>${c.obLevel}</td>
        <td>${c.maxStack}</td>
        <td>${fmt(o?.chartDays, 1)}</td>
        ${moneyCell(o?.netProfit, o?.netProfitPct)}
        ${moneyCell(o?.longProfit, o?.longProfitPct)}
        ${moneyCell(o?.shortProfit, o?.shortProfitPct)}
        ${moneyCell(o?.grossProfit, o?.grossProfitPct)}
        ${moneyCell(o?.grossLoss, o?.grossLossPct)}
        <td>${fmt(o?.closedTrades, 0)}</td>
        <td>${fmt(o?.percentProfitable, 2)}</td>
        <td>${o?.profitFactor === Infinity || o?.profitFactor === "Infinity" ? "∞" : fmt(o?.profitFactor)}</td>
        ${moneyCell(
          num(o?.maxDrawdown) == null ? null : -Math.abs(o.maxDrawdown),
          num(o?.maxDrawdownPct) == null ? null : -Math.abs(o.maxDrawdownPct)
        )}
        ${moneyCell(
          num(o?.maxTradeMae) == null ? null : -Math.abs(o.maxTradeMae),
          num(o?.maxTradeMaePct) == null ? null : -Math.abs(o.maxTradeMaePct)
        )}
        <td>${fmt(o?.liquidations, 0)}</td>
        ${moneyCell(o?.avgTrade, o?.avgTradePct)}
        <td>${fmt(o?.avgBars, 1)}</td>
        ${moneyCell(row.best?.train?.netProfit, row.best?.train?.netProfitPct)}
        ${moneyCell(row.best?.test?.netProfit, row.best?.test?.netProfitPct)}
        ${suitabilityCell(row)}
      </tr>`;
    })
    .join("");
}

function renderChrome() {
  const unfinished = hasUnfinishedRows(state.rows);
  btnStart.disabled = !!state.running;
  btnStart.textContent = !state.running && unfinished ? "Продолжить" : "Старт";
  btnPause.disabled = !state.running;
  const p = state.progress || {};
  const comboFrac = p.comboTotal > 0 ? p.comboDone / p.comboTotal : 0;
  const overall = p.total > 0 ? (p.done + comboFrac) / p.total : 0;
  barFill.style.width = `${Math.min(100, overall * 100)}%`;
  const phase = p.phase || "idle";
  const rowCount = (state.rows || []).length;
  const savedLabel = formatSavedAt(state);
  statusLine.textContent = state.running
    ? `В таблице ${rowCount} тикеров · ${p.currentSymbol || ""} · ${p.done || 0}/${p.total || 0} · комбинации ${p.comboDone || 0}/${p.comboTotal || 0}`
    : phase === "done"
      ? `Готово · в таблице ${rowCount} тикеров${savedLabel}`
      : phase === "paused" || (state.paused && unfinished)
        ? `На паузе · в таблице ${rowCount} тикеров · нажмите Продолжить${savedLabel}`
        : phase === "stopped"
          ? `Остановлено · в таблице ${rowCount} тикеров${savedLabel}`
          : unfinished
            ? `Недосчитано · в таблице ${rowCount} тикеров · нажмите Продолжить${savedLabel}`
            : rowCount
              ? `Прошлый прогон · в таблице ${rowCount} тикеров${savedLabel}`
              : state.error || "Ожидание";
  const c = state.counts || {};
  countsEl.textContent =
    `в таблице ${rowCount} · готово ${c.done || 0} / ${c.total || 0}` +
    ` · ожидают ${c.queued || 0} · можно ${c.ok || 0}` +
    ` · набор найден ${c.found || 0} · ошибки ${c.errors || 0}`;
  if (state.log) {
    logEl.textContent = state.log
      .map((line) => `${line.at?.slice(11, 19) || ""}  ${line.message}`)
      .join("\n");
  }
}

function formatSavedAt(snap) {
  const raw = snap?.stoppedAt || snap?.startedAt || snap?.savedAt;
  if (!raw) {
    return "";
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return ` · сохранён ${d.toLocaleString("ru-RU")}`;
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows) || !parsed.rows.length) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveLocal(snap) {
  if (!snap?.rows?.length) {
    clearLocal();
    return;
  }
  try {
    localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        running: false,
        paused: snap.paused === true,
        startedAt: snap.startedAt,
        stoppedAt: snap.stoppedAt,
        config: snap.config,
        fingerprint: snap.fingerprint,
        progress: snap.progress,
        counts: snap.counts,
        rows: snap.rows,
        log: (snap.log || []).slice(-20)
      })
    );
  } catch {
    /* quota */
  }
}

function clearLocal() {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

function applyState(next, opts = {}) {
  state = next || state;
  if (!useBackend && state.rows?.length && !state.running) {
    hydrateClientSession(state);
  }
  renderChrome();
  const stamp = (state.rows || [])
    .map(
      (r) =>
        `${r.updatedAt}|${r.symbol}|${r.status}|${r.best?.overview?.netProfit}|${r.best?.prefs?.cycleSlEnabled}`
    )
    .join(";");
  if (opts.force || stamp !== lastRowStamp) {
    lastRowStamp = stamp;
    renderTable();
  }
  if (state.rows?.length) {
    saveLocal(state);
  } else {
    clearLocal();
  }
}

function applyProgress(patch) {
  state = {
    ...state,
    running: patch.running,
    progress: patch.progress || state.progress,
    counts: patch.counts || state.counts,
    log: patch.log || state.log
  };
  renderChrome();
}

function readForm() {
  const data = new FormData(form);
  const symbols = String(data.get("symbols") || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    exchange: data.get("exchange"),
    universe: data.get("universe"),
    symbols,
    chartTf: data.get("chartTf"),
    rsiTf: data.get("rsiTf"),
    budget: Number(data.get("budget")),
    sizeMode: data.get("sizeMode"),
    sizeMult: Number(data.get("sizeMult")),
    commissionPct: Number(data.get("commissionPct")),
    trainPct: Number(data.get("trainPct")),
    workers: Number(data.get("workers")),
    comboLimit: Number(data.get("comboLimit")),
    cycleSlEnabled: form.elements.cycleSlEnabled.checked,
    cycleSlPct: Number(data.get("cycleSlPct")),
    compoundEnabled: form.elements.compoundEnabled.checked,
    force: form.elements.force.checked
  };
}

function fillForm(config, opts = {}) {
  if (!config) {
    return;
  }
  const skip = new Set(["symbols", "comboLimit", "force"]);
  if (opts.keepCycleSl) {
    skip.add("cycleSlEnabled");
    skip.add("cycleSlPct");
    skip.add("compoundEnabled");
  }
  for (const [key, value] of Object.entries(config)) {
    if (skip.has(key)) {
      continue;
    }
    const el = form.elements[key];
    if (!el) {
      continue;
    }
    if (el.type === "checkbox") {
      el.checked = value === true;
    } else if (value != null) {
      el.value = value;
    }
  }
  form.elements.symbols.value = Array.isArray(config.symbols) && config.symbols.length
    ? config.symbols.join(", ")
    : "";
  form.elements.comboLimit.value = "0";
}

btnStart.addEventListener("click", async () => {
  if (!useBackend) {
    try {
      await startClientScan(readForm(), (snap) => applyState(snap, { force: true }), applyProgress);
    } catch (err) {
      statusLine.textContent = err?.message || "Не удалось стартовать";
    }
    return;
  }
  const res = await fetch("./api/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(readForm())
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    statusLine.textContent = json.error || "Не удалось стартовать";
  }
});

function pauseScan() {
  if (!useBackend) {
    pauseClientScan();
    return;
  }
  fetch("./api/pause", { method: "POST" }).catch(() => {
    fetch("./api/stop", { method: "POST" });
  });
}

btnPause.addEventListener("click", pauseScan);

async function resetScan() {
  lastRowStamp = "";
  if (!useBackend) {
    try {
      const snap = await resetClientScan();
      applyState(snap, { force: true });
    } catch (err) {
      statusLine.textContent = err?.message || "Не удалось сбросить";
    }
    return;
  }
  try {
    const res = await fetch("./api/reset", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusLine.textContent = json.error || "Не удалось сбросить";
      return;
    }
    applyState(json, { force: true });
  } catch (err) {
    statusLine.textContent = err?.message || "Не удалось сбросить";
  }
}

btnReset.addEventListener("click", () => {
  void resetScan();
});

window.addEventListener("pagehide", () => {
  if (!useBackend && state.running) {
    pauseClientScan();
  }
});
document.addEventListener("freeze", () => {
  if (!useBackend && state.running) {
    pauseClientScan();
  }
});

document.getElementById("btn-csv").addEventListener("click", (ev) => {
  if (useBackend) {
    return;
  }
  ev.preventDefault();
  exportClientCsv();
});

document.getElementById("btn-json").addEventListener("click", (ev) => {
  if (useBackend) {
    return;
  }
  ev.preventDefault();
  exportClientJson();
});

async function importResultsFile(file) {
  const text = await file.text();
  const payload = parseImportFile(text, file.name);
  if (useBackend) {
    const res = await fetch("./api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error || "Не удалось загрузить файл");
    }
    fillForm(json.config);
    applyState(json, { force: true });
    return Object.keys(payload.rows).length;
  }
  const snap = await importClientSnapshot(payload);
  fillForm(snap.config);
  applyState(snap, { force: true });
  return Object.keys(payload.rows).length;
}

btnImport.addEventListener("click", () => {
  importFile.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) {
    return;
  }
  try {
    const count = await importResultsFile(file);
    statusLine.textContent = `Загружено ${count} тикеров из ${file.name}`;
  } catch (err) {
    statusLine.textContent = err?.message || "Не удалось загрузить файл";
  }
});

async function loadSavedFromServer() {
  for (const request of [
    () => fetch("./api/reload", { method: "POST" }),
    () => fetch("./api/state")
  ]) {
    try {
      const res = await request();
      if (!res.ok) {
        continue;
      }
      const json = await res.json();
      if (json?.rows?.length) {
        return json;
      }
    } catch {
      /* next */
    }
  }
  return null;
}

async function showSaved() {
  if (!useBackend) {
    const saved = await loadClientState();
    if (saved?.rows?.length) {
      fillForm(saved.config);
      applyState(saved, { force: true });
      return;
    }
    const localOnly = readLocal();
    if (localOnly) {
      fillForm(localOnly.config);
      applyState(localOnly, { force: true });
      return;
    }
    statusLine.textContent = "Сохранённого прогона пока нет";
    return;
  }
  try {
    const fromServer = await loadSavedFromServer();
    if (fromServer) {
      fillForm(fromServer.config);
      applyState(fromServer, { force: true });
      return;
    }
  } catch {
    /* server down */
  }
  const local = readLocal();
  if (local) {
    fillForm(local.config);
    applyState(local, { force: true });
    statusLine.textContent =
      `Прошлый прогон (копия в браузере) · в таблице ${local.rows.length} тикеров` +
      formatSavedAt(local);
    return;
  }
  statusLine.textContent = "Сохранённого прогона пока нет";
}

btnSaved.addEventListener("click", () => {
  showSaved();
});

filterEl.addEventListener("input", renderTable);

let cycleSlReady = false;
let cycleSlTouched = false;
let cycleSlTimer = 0;

function queueCycleSl() {
  if (!cycleSlReady) {
    return;
  }
  window.clearTimeout(cycleSlTimer);
  cycleSlTimer = window.setTimeout(() => {
    void sendCycleSl();
  }, 280);
}

async function sendCycleSl() {
  hydrateClientSession(state);
  const body = readForm();
  if (!useBackend) {
    try {
      await applyClientCycleSl(body, (snap) => applyState(snap, { force: true }));
    } catch (err) {
      statusLine.textContent = err?.message || "Не удалось пересчитать оверлей";
    }
    return;
  }
  try {
    const res = await fetch("./api/cycle-sl", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      statusLine.textContent = "Не удалось пересчитать СЛ цикла";
    }
  } catch (err) {
    statusLine.textContent = err?.message || "Не удалось пересчитать СЛ цикла";
  }
}

form.elements.cycleSlEnabled.addEventListener("change", () => {
  cycleSlTouched = true;
  queueCycleSl();
});
form.elements.cycleSlPct.addEventListener("change", () => {
  cycleSlTouched = true;
  queueCycleSl();
});
form.elements.compoundEnabled.addEventListener("change", () => {
  cycleSlTouched = true;
  queueCycleSl();
});

for (const th of document.querySelectorAll("th[data-sort]")) {
  th.addEventListener("click", () => {
    const key = th.getAttribute("data-sort");
    if (sortKey === key) {
      sortDir = sortDir === "desc" ? "asc" : "desc";
    } else {
      sortKey = key;
      sortDir = key === "symbol" ? "asc" : "desc";
    }
    renderTable();
  });
}

if (useBackend) {
  const es = new EventSource("./api/events");
  es.addEventListener("state", (ev) => {
    try {
      applyState(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  });
  es.addEventListener("progress", (ev) => {
    try {
      applyProgress(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  });
  es.onmessage = (ev) => {
    try {
      applyState(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  };
}

const local = readLocal();
if (local) {
  fillForm(local.config);
  applyState(local, { force: true });
}

if (useBackend) {
  fetch("./api/state")
    .then((r) => r.json())
    .then((json) => {
      fillForm(json.config, { keepCycleSl: cycleSlTouched });
      if (json.rows?.length) {
        applyState(json, { force: true });
        return;
      }
      if (!local) {
        applyState(json, { force: true });
      }
    })
    .catch(() => {
      if (!local) {
        statusLine.textContent = "Нет связи с сервером и нет сохранённого прогона";
      }
    });
} else {
  const saved = await loadClientState();
  if (saved?.rows?.length) {
    fillForm(saved.config);
    applyState(saved, { force: true });
  } else if (!local) {
    statusLine.textContent =
      "Откройте страницу и нажмите Старт — подбор идёт в этом браузере";
  }
}

cycleSlReady = true;
renderTable();
