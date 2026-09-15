import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ScanController } from "../src/scan.js";

test("reset clears queued rows and the saved snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "rsi-screener-reset-"));
  const controller = new ScanController(root);
  controller.rows = {
    BTCUSDT: { symbol: "BTCUSDT", status: "queued" },
    ETHUSDT: { symbol: "ETHUSDT", status: "running" }
  };
  controller.paused = true;
  controller.startedAt = "2026-09-02T00:00:00.000Z";
  controller.fingerprint = "stay-not";

  const snap = await controller.reset();

  assert.equal(controller.paused, false);
  assert.equal(controller.running, false);
  assert.deepEqual(controller.rows, {});
  assert.equal(controller.fingerprint, "");
  assert.equal(snap.progress.phase, "idle");
  assert.equal(snap.rows.length, 0);

  const saved = JSON.parse(
    await readFile(path.join(root, "data", "results.json"), "utf8")
  );
  assert.deepEqual(saved.rows, {});
});
