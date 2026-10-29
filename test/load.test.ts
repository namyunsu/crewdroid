import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLevel, cpuBusy, fillerName, parseMeminfo, RECIPES } from "../src/load.ts";

test("load: levels are checked, recipes grow from low to high", () => {
  assert.equal(checkLevel("mid"), "mid");
  assert.throws(() => checkLevel("max"), /unknown load level 'max' \(off\|low\|mid\|high\)/);
  const [l, m, h] = [RECIPES.low, RECIPES.mid, RECIPES.high];
  for (const k of ["fillers", "procs", "cpuPct", "alarms", "jobs"] as const) assert.ok(l[k] < m[k] && m[k] < h[k], k);
  assert.ok(l.availPct > m.availPct && m.availPct > h.availPct);
  assert.ok(h.procs <= 30, "the load app declares 30 process services"); // load-app AndroidManifest Procs$P1..P30
  assert.equal(fillerName(7), "dev.crewdroid.filler.f007");
});

test("load: meminfo and /proc/stat parsing", () => {
  assert.deepEqual(parseMeminfo("MemTotal:  2021376 kB\nMemFree: 1 kB\nMemAvailable:  948812 kB\nSwapTotal: 1000 kB\nSwapFree: 400 kB\n"), { totalKb: 2021376, availKb: 948812, swapTotalKb: 1000, swapFreeKb: 400 });
  // user nice system idle iowait ...: 300 of 400 ticks busy
  assert.equal(cpuBusy("cpu  100 0 100 1000 0 0 0", "cpu  250 0 250 1090 10 0 0"), 75);
  assert.equal(cpuBusy("cpu 1 1 1 1", "cpu 1 1 1 1"), 0);
});
