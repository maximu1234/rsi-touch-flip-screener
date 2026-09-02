import test from "node:test";
import assert from "node:assert/strict";
import { pickScanSymbols } from "../src/scan-resume.js";

test("fresh start with empty symbols fetches universe", () => {
  assert.equal(pickScanSymbols({ symbols: [] }, { symbols: [] }, {}, false), null);
});

test("form symbols win on resume", () => {
  assert.deepEqual(
    pickScanSymbols(
      { symbols: ["BTCUSDT"] },
      { symbols: ["ETHUSDT"] },
      { SOLUSDT: { symbol: "SOLUSDT", status: "queued" } },
      true
    ),
    ["BTCUSDT"]
  );
});

test("after reload, empty form keeps previous explicit symbols", () => {
  assert.deepEqual(
    pickScanSymbols(
      { symbols: [] },
      { symbols: ["BTCUSDT", "ETHUSDT"] },
      {
        BTCUSDT: { status: "queued" },
        ETHUSDT: { status: "queued" }
      },
      true
    ),
    ["BTCUSDT", "ETHUSDT"]
  );
});

test("all-universe resume uses saved row queue, not a new listing", () => {
  assert.deepEqual(
    pickScanSymbols(
      { symbols: [] },
      { symbols: [] },
      {
        BTCUSDT: { status: "done" },
        ETHUSDT: { status: "queued" }
      },
      true
    ),
    ["BTCUSDT", "ETHUSDT"]
  );
});

test("array rows still yield ticker names", () => {
  assert.deepEqual(
    pickScanSymbols(
      { symbols: [] },
      { symbols: [] },
      [{ symbol: "BTCUSDT", status: "queued" }],
      true
    ),
    ["BTCUSDT"]
  );
});
