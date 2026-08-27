import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { ScanController } from "./scan.js";
import { normalizeConfig } from "./defaults.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--exchange" && next) {
      out.exchange = next;
      i += 1;
    } else if (arg === "--universe" && next) {
      out.universe = next;
      i += 1;
    } else if (arg === "--symbols" && next) {
      out.symbols = next.split(/[,\s]+/).filter(Boolean);
      i += 1;
    } else if (arg === "--workers" && next) {
      out.workers = Number(next);
      i += 1;
    } else if (arg === "--budget" && next) {
      out.budget = Number(next);
      i += 1;
    } else if (arg === "--combo-limit" && next) {
      out.comboLimit = Number(next);
      i += 1;
    } else if (arg === "--chart-tf" && next) {
      out.chartTf = next;
      i += 1;
    } else if (arg === "--rsi-tf" && next) {
      out.rsiTf = next;
      i += 1;
    } else if (arg === "--force") {
      out.force = true;
    } else if (arg === "--refresh-cache") {
      out.refreshCache = true;
    } else if (arg === "--cycle-sl") {
      out.cycleSlEnabled = true;
    } else if (arg === "--config" && next) {
      out._configFile = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    }
  }
  return out;
}

const help = `RSI Touch Flip Screener (отдельное приложение, не Multichart)

  npm start                 локальный UI http://127.0.0.1:3847
  npm run scan -- [opts]    тот же подбор в терминале

Опции:
  --exchange bybit          пока только bybit
  --universe all|top100     все линейные USDT-перпы или топ-100 по обороту
  --symbols BTCUSDT,ETHUSDT явный список (для проверки)
  --workers 2
  --budget 30
  --chart-tf 5
  --rsi-tf 1
  --combo-limit 0           0 = полная сетка (~74970), иначе первые N
  --force                   пересчитать уже сохранённые тикеры
  --refresh-cache           заново скачать свечи
  --cycle-sl                включить СЛ цикла
  --config config.json
`;

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const parsed = parseArgs(process.argv.slice(2));
if (parsed.help) {
  console.log(help);
  process.exit(0);
}

let fileConfig = {};
if (parsed._configFile) {
  fileConfig = JSON.parse(await readFile(parsed._configFile, "utf8"));
}
delete parsed._configFile;
delete parsed.help;
const config = normalizeConfig({ ...fileConfig, ...parsed });

const controller = new ScanController(ROOT);
await controller.load();
controller.on((_kind, state) => {
  if (!state.running) {
    return;
  }
  const p = state.progress;
  if (p.currentSymbol && p.comboTotal) {
    process.stdout.write(
      `\r${p.done}/${p.total} ${p.currentSymbol} ${p.comboDone}/${p.comboTotal}   `
    );
  }
});

try {
  await controller.start(config);
  console.log("\nГотово. CSV: data/results.json (UI: npm start → Export CSV)");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
