// T53 verify: node scripts/check-compact.mjs [--base-port 5580]   (~4 min)
// Builds agent-helper/ and Field Notes (demo-app/), boots 1 device (s24ultra, API 34), starts the sample server for the app's
// sync and drives it only through the CLI defaults an agent sees: `screen` (compact outline, <= 2400 chars, every visible card
// title + "Synced" + "New note"), `tap --text "New note"` (returned screen shows the editor's "What needs doing?"), `tap [n]`
// by an index from that returned screen (no new screen call), `logs` (<= 40 lines, has FieldNotes) and `screen --json`
// (T22 fields kept). Always downs its emulator.
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { install, launch } from "../src/appctl.ts";
import { buildHelper } from "../src/helper.ts";
import { sleep } from "../src/snapshot.ts";
import { down, up } from "../src/up.ts";
import { startApp } from "../sample/server/app.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" } } });
const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const APP = "dev.crewdroid.demo", PORT = 5598, MAX_CHARS = 2400;
const errs = [];
const claim = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const crew = (...args) => new Promise((ok) => {
  const t0 = performance.now();
  execFile(process.execPath, ["--import", "tsx", cli, ...args], { cwd: root, windowsHide: true, maxBuffer: 64 << 20 }, (e, out, err) =>
    ok({ code: e ? e.code ?? 1 : 0, out: String(out).replace(/\r?\n$/, ""), err: String(err).trim().slice(0, 300), ms: Math.round(performance.now() - t0) }));
});
const show = (out) => out.split("\n").map((l) => `    | ${l}`).join("\n");

buildHelper();
execFileSync(join(root, "probe-app", process.platform === "win32" ? "gradlew.bat" : "gradlew"), ["-p", join(root, "demo-app"), "assembleDebug", "--console=plain", "-q"], { cwd: join(root, "probe-app"), stdio: "inherit", shell: process.platform === "win32" });
const apk = join(root, "demo-app/build/outputs/apk/debug/crewdroid-demo-debug.apk");

const work = mkdtempSync(join(tmpdir(), "crewcompact-"));
let server;
try {
  await down();
  server = await startApp({ port: PORT, dir: join(work, "server") });
  const r = await up(1, Number(v["base-port"]), ["s24ultra"], false, { api: 34 });
  const s = r.devices[0].serial;
  claim(r.devices[0].helper?.ok, `${s} ${r.devices[0].profile} API ${r.devices[0].api}, helper ${JSON.stringify(r.devices[0].helper)}`);
  claim((await install(s, apk)).ok, `install Field Notes`);
  await launch(s, APP, { restart: true, extras: ["--es", "server", `http://10.0.2.2:${PORT}`] });
  await sleep(4000); // list animation + first sync round

  // the JSON tree (T22 fields) is the reference for what is visible
  let x = await crew("screen", s, "--json");
  let j = JSON.parse(x.out);
  const t22 = ["serial", "focus", "nodes", "via", "blackRelaunch"].every((k) => k in j) && j.nodes.length > 0 && j.nodes.every((n) => ["cls", "text", "desc", "id", "bounds", "clickable", "depth"].every((k) => k in n));
  claim(x.code === 0 && t22, `screen --json keeps the T22 structure: ${Object.keys(j).join(",")}; ${j.nodes.length} nodes {${Object.keys(j.nodes[0] ?? {}).join(",")}}, via ${j.via}, ${x.out.length} chars`);
  const H = j.size?.height ?? 2340;
  const titles = j.nodes.filter((n) => n.id.endsWith(":id/note_title") && n.bounds[1] < H && n.bounds[3] > 0 && n.bounds[3] > n.bounds[1]).map((n) => n.text);

  x = await crew("screen", s);
  const missing = [...titles, "Synced", "New note"].filter((t) => !x.out.includes(t));
  claim(x.code === 0 && x.out.length <= MAX_CHARS && titles.length >= 3 && !missing.length,
    `screen (default) ${x.out.length} chars (<= ${MAX_CHARS}, ~${Math.ceil(x.out.length / 4)} tokens; JSON ${j && JSON.stringify(j).length} chars), ${x.out.split("\n").length} lines, ${x.ms} ms; names ${titles.length} visible card titles + Synced + New note${missing.length ? `; MISSING ${JSON.stringify(missing)}` : ""}\n${show(x.out)}`);

  x = await crew("tap", s, "--text", "New note");
  claim(x.code === 0 && x.out.includes("What needs doing?"), `tap --text "New note" returns the editor screen (${x.out.length} chars, ${x.ms} ms) with "What needs doing?"\n${show(x.out)}`);

  // an index from the returned screen: the "North field" site chip (unchecked; the first chip is checked by default)
  const line = x.out.split("\n").find((l) => /\] check "North field"/.test(l));
  const n = line?.match(/\[(\d+)\]/)?.[1];
  const before = line ?? "";
  x = n !== undefined ? await crew("tap", s, `[${n}]`) : { code: -1, out: "no North field line", ms: 0 };
  const after = x.out.split("\n").find((l) => /\] check "North field"/.test(l)) ?? "";
  claim(x.code === 0 && !/checked/.test(before) && /checked/.test(after) && /^tapped \d+,\d+ "North field"/.test(x.out),
    `tap [${n}] from that output (no screen call in between): ${x.out.split("\n")[0]} | before: ${before.trim()} | after: ${after.trim()} (${x.ms} ms)`);
  await crew("key", s, "back", "--no-screen");
  await crew("key", s, "back", "--no-screen");

  x = await crew("logs", s, APP);
  const lines = x.out ? x.out.split("\n") : [];
  claim(x.code === 0 && lines.length <= 40 && lines.length > 0 && x.out.includes("FieldNotes"), `logs (default) ${lines.length} lines (<= 40), ${x.out.length} chars, has FieldNotes; stderr: ${x.err || "-"}\n${show(lines.slice(-5).join("\n"))}`);
  const all = await crew("logs", s, APP, "--all", "--json");
  claim(all.code === 0, `logs --all: ${JSON.parse(all.out).lines.length} lines at level V (the old default) vs ${lines.length}`);

  await down();
  claim(true, `down`);
} catch (e) {
  claim(false, `error: ${e.stack ?? e}`);
} finally {
  await down().catch((e) => console.log(`down failed: ${e.message}`));
  if (server) await new Promise((ok) => server.close(ok));
  rmSync(work, { recursive: true, force: true });
}
if (errs.length) { console.log(`FAIL: ${errs.length} claims failed`); process.exit(1); }
console.log("OK: compact screen, returned screens, tap [n] and short logs hold on Field Notes");
