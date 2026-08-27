import * as bybit from "./bybit.js";
import * as bingx from "./bingx.js";

const adapters = { bybit, bingx };

export function getExchange(id) {
  const key = String(id || "bybit").toLowerCase();
  const adapter = adapters[key];
  if (!adapter) {
    throw new Error(`Нет адаптера биржи: ${key}`);
  }
  return adapter;
}
