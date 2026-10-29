// T67 verify: node scripts/check-layout-cmd.mjs [--base-port 5580] [--apk <non-demo app.apk> --pkg <its package>]   (~6 min)
// Builds agent-helper/ and the probe, boots ONE device (s24ultra) and runs `crewdroid layout` through the CLI:
//   probe check=layout-bad, default matrix (15 combos) -> exit 1, findings of every kind wrap/clip/offscreen/overlap/target, a PNG per combo
//   probe check=layout-ok, default matrix -> exit 0, no findings; the device's wm size/density and font scale are restored
//   --flow (Maestro opens layout-bad) on 1 combo -> findings; --flow with Maestro off PATH -> exit 1 saying so
//   MCP: the `layout` tool answers for 1 combo
// --apk/--pkg: also one default-matrix run on that app (result printed; findings are the app's, not a failure).
// Always downs its emulators.
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { adb } from "../src/adb.ts";
import { install } from "../src/appctl.ts";
import { buildHelper } from "../src/helper.ts";
import { PKG, probeApk } from "../src/snapshot.ts";
import { down, up } from "../src/up.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, apk: { type: "string" }, pkg: { type: "string" } } });
const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const tmp = mkdtempSync(join(tmpdir(), "crewdroid-layout-"));
const KINDS = ["wrap", "clip", "offscreen", "overlap", "target"];
const errs = [];
const claim = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const crew = (args, env = process.env) => new Promise((ok) => {
  const t0 = performance.now();
  execFile(process.execPath, ["--import", "tsx", cli, ...args], { cwd: root, env, windowsHide: true, maxBuffer: 64 << 20, timeout: 900000 }, (e, out, err) => {
    let json = null;
    try { json = JSON.parse(out); } catch { json = null; }
    ok({ code: e ? e.code ?? 1 : 0, json, out, err: String(err).trim(), seconds: Math.round((performance.now() - t0) / 100) / 10 });
  });
});
const kindsOf = (r) => [...new Set((r.json?.combos ?? []).flatMap((c) => c.findings.map((f) => f.kind)))].sort();

console.log("building agent-helper and probe-app");
buildHelper();
execFileSync(join(root, "probe-app", process.platform === "win32" ? "gradlew.bat" : "gradlew"), ["-p", join(root, "probe-app"), "assembleDebug", "--console=plain", "-q"], { cwd: join(root, "probe-app"), stdio: "inherit", shell: process.platform === "win32" });

try {
  const r = await up(1, Number(v["base-port"]), ["s24ultra"]);
  const s = r.devices[0].serial;
  const sh = (c) => adb(s, ["shell", c]);
  const inst = await install(s, probeApk());
  if (!inst.ok) throw new Error(`probe install failed: ${JSON.stringify(inst.results)}`);
  // effective values: Android drops an override equal to the physical value, so "Override size: 1080x2340" may come back as none
  const eff = (o) => (o.match(/Override \w+: (\S+)/) ?? o.match(/Physical \w+: (\S+)/) ?? [, o.trim()])[1];
  const wm = async () => [eff(await sh("wm size")), eff(await sh("wm density")), eff(await sh("settings get system font_scale")).replace(/^null$/, "1.0")].join(" "); // unset = 1.0; Android writes 1.0 back on its own at times
  const wmBefore = await wm();

  const bad = await crew(["layout", s, PKG, "--json", "--out", join(tmp, "bad"), "--", "--es", "check", "layout-bad"]);
  const b = bad.json;
  claim(bad.code === 1 && b?.combos?.length === 15, `layout-bad: exit ${bad.code} (want 1), ${b?.combos?.length} combos (want 15) in ${bad.seconds}s${bad.code > 1 || !b ? `: ${bad.err.slice(-300)}` : ""}`);
  claim(KINDS.every((k) => kindsOf(bad).includes(k)), `layout-bad: finding kinds ${JSON.stringify(kindsOf(bad))} include every one of ${KINDS.join("/")}`);
  const perCombo = (b?.combos ?? []).filter((c) => KINDS.every((k) => c.findings.some((f) => f.kind === k))).length;
  const short = (b?.combos ?? []).filter((c) => !KINDS.every((k) => c.findings.some((f) => f.kind === k))).map((c) => `${c.profile}/${c.font} missing ${KINDS.filter((k) => !c.findings.some((f) => f.kind === k))} (has ${c.findings.map((f) => `${f.kind} ${f.text ?? f.id} [${f.bounds}] ${f.detail}`).join("; ")})`);
  claim(perCombo === 15, `layout-bad: ${perCombo} of 15 combos show all five kinds${short.length ? `: ${short.join(" | ")}` : ""}`);
  claim((b?.combos ?? []).every((c) => c.ok || (c.png && existsSync(c.png))), `layout-bad: every combo with findings has its PNG (${(b?.combos ?? []).filter((c) => c.png).length})`);
  claim(typeof b?.summary?.seconds === "number", `layout-bad: 15 combos took ${b?.summary?.seconds}s (summary.seconds)`);

  const ok = await crew(["layout", s, PKG, "--json", "--out", join(tmp, "ok"), "--", "--es", "check", "layout-ok"]);
  const findings = (ok.json?.combos ?? []).flatMap((c) => c.findings.map((f) => `${c.profile}/${c.font} ${f.kind} ${f.text ?? f.id}: ${f.detail}`));
  claim(ok.code === 0 && ok.json?.combos?.length === 15 && findings.length === 0, `layout-ok: exit ${ok.code} (want 0), ${ok.json?.combos?.length} combos, ${findings.length} findings in ${ok.seconds}s${findings.length ? `: ${findings.slice(0, 5).join("; ")}` : ""}${ok.code && !ok.json ? `: ${ok.err.slice(-300)}` : ""}`);
  const wmAfter = await wm();
  claim(wmAfter === wmBefore, `screen size, density and font scale restored: ${wmAfter} (before: ${wmBefore})`);

  const flow = join(tmp, "open-layout-bad.yaml");
  writeFileSync(flow, `appId: ${PKG}\n---\n- launchApp:\n    arguments:\n      check: layout-bad\n- assertVisible: "Layout check"\n`);
  const one = ["--profiles", "s24ultra", "--fonts", "1.0", "--json", "--out", join(tmp, "flow")];
  const fl = await crew(["layout", s, PKG, "--flow", flow, ...one]);
  claim(fl.code === 1 && kindsOf(fl).includes("overlap"), `--flow: Maestro opened layout-bad, exit ${fl.code}, kinds ${JSON.stringify(kindsOf(fl))}${fl.json ? "" : `: ${fl.err.slice(-300)}`}`);
  const noPath = { ...process.env, PATH: [join(process.env.SystemRoot ?? "C:\\Windows", "System32"), "/usr/bin", "/bin"].join(process.platform === "win32" ? ";" : ":") };
  delete noPath.Path;
  const nm = await crew(["layout", s, PKG, "--flow", flow, ...one], noPath);
  claim(nm.code === 1 && /needs Maestro/.test(nm.err), `--flow without Maestro on PATH: exit ${nm.code}, "${nm.err.split("\n").at(-1).slice(0, 160)}"`);

  const client = new Client({ name: "check-layout-cmd", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", cli, "mcp"], env: process.env }));
  try {
    const res = await client.callTool({ name: "layout", arguments: { serial: s, pkg: PKG, profiles: ["flip6-cover"], fonts: [2.0], extras: ["--es", "check", "layout-bad"], out: join(tmp, "mcp") } }, undefined, { timeout: 300000 });
    const j = res.isError ? null : JSON.parse(res.content[0].text);
    claim(j?.combos.length === 1 && !j.ok && j.combos[0].findings.length >= 5, `MCP layout tool: flip6-cover font 2.0, ${j ? `${j.combos[0].findings.length} findings, png ${j.combos[0].png}` : res.content[0].text.slice(0, 300)}`);
  } finally { await client.close(); }

  if (v.apk && v.pkg) {
    const ia = await install(s, v.apk);
    claim(ia.ok, `install ${v.apk}: ${ia.results[0].result}`);
    const app = await crew(["layout", s, v.pkg, "--out", join(tmp, v.pkg)]);
    console.log(app.out.trim());
    claim(app.json === null && (app.code === 0 || app.code === 1) && /combos with findings/.test(app.out), `${v.pkg}: one command ran end to end (exit ${app.code} = ${app.code ? "findings" : "clean"}) in ${app.seconds}s`);
  }
} finally {
  await down().catch((e) => console.error(`down: ${e.message}`));
}
console.log(`PNGs under ${tmp}`);
if (errs.length) { console.error(`FAIL: ${errs.length} claim(s) failed`); process.exit(1); }
console.log("OK: layout finds every kind on the broken fixture, none on the fixed one, --flow and MCP work");
