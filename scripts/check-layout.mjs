// T51 verify: node scripts/check-layout.mjs   (builds demo-app, boots 1 device, 5 profiles x 3 font scales = 30 captures; ~10 min)
// Field Notes layout sweep. One device (s24ultra), profiles switched with wm size/density (what `up --profile` applies), font
// scale with `env font`, app restarted after each switch (force-stop, 2 s, start). Per combo: the list and the editor sheet.
// Evidence: .ai-log/evidence/T51/<profile>-<font>-<list|editor>.{png,json} + summary.json. Static checks run first.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adb } from "../src/adb.ts";
import { install, launch } from "../src/appctl.ts";
import { envSet } from "../src/env.ts";
import { swipe, tap, type } from "../src/input.ts";
import { loadProfiles } from "../src/profiles.ts";
import { screen } from "../src/screen.ts";
import { down, up } from "../src/up.ts";

const root = join(import.meta.dirname, "..");
const res = join(root, "demo-app/src/main/res");
const out = join(root, ".ai-log/evidence/T51");
const PKG = "dev.crewdroid.demo", PORT = 5580;
const PROFILES = ["s24ultra", "fold5-cover", "fold5-main", "flip6-cover", "trifold-main"];
const FONTS = [1.0, 1.3, 2.0];
// A label that wraps to 2 lines is ~2x as tall as its single line. Calibrated on the 30 captures: single-line labels at font 2.0 grow at most
// 1.28x (the title field, summary.json ratios), so 2 separates wrapping from padding growth.
const WRAP_FACTOR = 2;
// Clickable labels each screen must offer. A sheet taller than the screen (Flip cover at font 2.0) is fine only when it scrolls to them.
const EXPECT = { list: ["New note"], editor: ["Pump house", "North field", "Warehouse", "Workshop", "Save"] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = (dir, ext) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith(ext)).map((d) => join(d.parentPath, d.name));
const uncomment = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));

// ---------- static checks ----------
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const colorsOf = (f) => Object.fromEntries([...readFileSync(f, "utf8").matchAll(/<color name="(\w+)">(#[0-9A-Fa-f]{6})<\/color>/g)].map((m) => [m[1], m[2]]));

function staticChecks() {
  const bad = [];
  const xml = files(res, ".xml");
  // 1. textSize >= 15sp unless marked <!-- caption --> (same line or the line above)
  for (const f of xml.filter((x) => /[\\/](layout|values[^\\/]*)[\\/]/.test(x))) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((l, i) => {
      const m = l.match(/textSize">?=?"?(\d+(?:\.\d+)?)sp/) ?? l.match(/android:textSize="(\d+(?:\.\d+)?)sp"/);
      if (m && Number(m[1]) < 15 && !/<!-- caption -->/.test(l) && !/<!-- caption -->/.test(lines[i - 1] ?? "")) bad.push(`${f}:${i + 1}: textSize ${m[1]}sp < 15sp (mark <!-- caption --> if it is a caption)`);
    });
  }
  // 2. no raw #RRGGBB outside values*/colors.xml
  for (const f of xml.filter((x) => !/values[^\\/]*[\\/]colors\.xml$/.test(x))) {
    uncomment(readFileSync(f, "utf8")).split("\n").forEach((l, i) => { if (/#[0-9A-Fa-f]{6}\b/.test(l)) bad.push(`${f}:${i + 1}: raw colour ${l.match(/#[0-9A-Fa-f]{6,8}/)[0]} (use res/values/colors.xml)`); });
  }
  // 3. contrast >= 4.5 for every text/background pair, light and night
  const light = colorsOf(join(res, "values/colors.xml")), night = { ...light, ...colorsOf(join(res, "values-night/colors.xml")) };
  const thumbs = [...readFileSync(join(root, "demo-app/src/main/kotlin/dev/crewdroid/demo/MainActivity.kt"), "utf8").matchAll(/to 0xFF([0-9A-F]{6})/g)].map((m) => `#${m[1]}`);
  const pairs = [["ink", "bg"], ["ink", "surface"], ["ink2", "bg"], ["ink2", "surface"], ["warn_ink", "warn_bg"], ["ok_ink", "ok_bg"], ["on_accent", "accent"]];
  const used = new Set(xml.flatMap((f) => [...uncomment(readFileSync(f, "utf8")).matchAll(/(?:textColor|textColorHint)">?=?"?@color\/(\w+)/g)].map((m) => m[1])));
  for (const u of used) if (!pairs.some((p) => p[0] === u) && u !== "thumb_ink") bad.push(`text colour @color/${u} has no background pair in check-layout.mjs`);
  const rows = [];
  for (const [mode, c] of [["light", light], ["night", night]]) {
    for (const [fg, bg] of pairs) rows.push([mode, fg, bg, contrast(c[fg], c[bg])]);
    for (const t of thumbs) rows.push([mode, "thumb_ink", t, contrast(c.thumb_ink, t)]);
  }
  for (const [mode, fg, bg, r] of rows) if (r < 4.5) bad.push(`contrast ${mode} ${fg} on ${bg} = ${r.toFixed(2)} < 4.5`);
  return { bad, contrastMin: Math.min(...rows.map((r) => r[3])), pairs: rows.length };
}

// ---------- per-capture checks ----------
const inter = (a, b) => Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
const h = (n) => n.bounds[3] - n.bounds[1];

function judge(nodes, size, kind, baseline, ellipsis, unreachable) {
  const fails = [];
  const show = (n) => `'${n.text || n.desc || n.id}' [${n.bounds}]`;
  for (const n of nodes) {
    if (!(n.text || n.clickable)) continue;
    if (n.bounds[2] > size.width || n.bounds[0] < 0) fails.push(`horizontal overflow: ${show(n)} screen width ${size.width}`);
    // the sheet has no scroll position to reach a cut-off button: bottom edge past the screen = unreachable
    if (kind === "editor" && n.clickable && (n.bounds[3] > size.height || n.bounds[1] < 0)) fails.push(`vertical overflow: ${show(n)} screen height ${size.height}`);
  }
  const ratios = {};
  for (const n of nodes.filter((x) => x.clickable && x.text)) {
    const base = baseline.get(`${kind}|${n.text}`);
    if (!base) continue;
    ratios[n.text] = Math.round((h(n) / base) * 100) / 100;
    if (h(n) > WRAP_FACTOR * base) fails.push(`label wrapped: ${show(n)} is ${h(n)} px, ${base} px at font 1.0 (> ${WRAP_FACTOR}x)`);
  }
  // touch_outside = the sheet's full-screen scrim; it is meant to sit under everything
  const click = nodes.filter((n) => n.clickable && !/touch_outside$/.test(n.id));
  for (let i = 0; i < click.length; i++) for (let j = i + 1; j < click.length; j++) if (inter(click[i].bounds, click[j].bounds)) fails.push(`clickable overlap: ${show(click[i])} x ${show(click[j])}`);
  if (unreachable.length) fails.push(`not reachable (missing, cut off at the screen edge, or no scroll to them): ${unreachable.join(", ")}`);
  if (kind === "list") {
    if (ellipsis.title !== 0) fails.push(`toolbar title ellipsized (title=${ellipsis.title})`);
    if (ellipsis.subtitle !== 0) fails.push(`toolbar subtitle ellipsized (subtitle=${ellipsis.subtitle})`);
    if (ellipsis.sync !== 0) fails.push(`sync chip ellipsized (${ellipsis.sync} px short)`);
  }
  return { fails, ratios };
}

// Labels fully on screen, scrolling the sheet up (up to 5 swipes) while some are not. Returns the ones never seen.
async function unreachableLabels(serial, nodes, size, kind) {
  const want = EXPECT[kind], seen = new Set();
  const look = (ns) => want.forEach((w) => { if (ns.some((n) => n.clickable && n.text === w && n.bounds[1] >= 0 && n.bounds[3] < size.height)) seen.add(w); });
  look(nodes);
  for (let i = 0; i < 5 && seen.size < want.length && kind === "editor"; i++) { await swipe(serial, { dir: "up" }); await sleep(500); look((await screen(serial)).nodes); }
  return want.filter((w) => !seen.has(w));
}

async function ellipsisNow(serial) {
  const log = await adb(serial, ["logcat", "-d", "-s", "FieldNotes:I"]);
  const m = [...log.matchAll(/LAYOUT title=(-?\d+) subtitle=(-?\d+) sync=(-?\d+)/g)].at(-1);
  if (!m) throw new Error("no LAYOUT line in logcat (debug build with logLayout?)");
  return { title: +m[1], subtitle: +m[2], sync: +m[3] };
}

// ---------- run ----------
const s = staticChecks();
console.log(`static: ${s.bad.length ? "FAIL" : "ok"} (${s.pairs} contrast pairs, min ${s.contrastMin.toFixed(2)}:1)`);
s.bad.forEach((b) => console.log(`  ${b}`));

execFileSync(join(root, "probe-app", process.platform === "win32" ? "gradlew.bat" : "gradlew"), ["-p", join(root, "demo-app"), "assembleDebug", "--console=plain", "-q"], { cwd: join(root, "probe-app"), stdio: "inherit", shell: process.platform === "win32" });
const apk = join(root, "demo-app/build/outputs/apk/debug/crewdroid-demo-debug.apk");
mkdirSync(out, { recursive: true });

const profiles = PROFILES.map((n) => loadProfiles().find((p) => p.name === n));
const failures = [], summary = [], baseline = new Map();
let serial;
try {
  const r = await up(1, PORT, ["s24ultra"]);
  serial = r.devices[0].serial;
  const sh = (c) => adb(serial, ["shell", c]);
  const res0 = await install(serial, apk);
  if (!res0.ok) throw new Error(`install failed: ${JSON.stringify(res0.results)}`);
  await sh(`pm clear ${PKG}`);
  const start = () => launch(serial, PKG, { restart: true });
  // Seed: the app's first launch lists 8 synced notes; one more saved through the editor stays "Pending" (no server), so the
  // Pending pill and the "Syncing" chip are on screen in every capture.
  await start();
  await tap(serial, { id: "fab" });
  await sleep(1500);
  await type(serial, "Check valve 7 before noon", "title");
  await tap(serial, { text: "Save" });
  await sleep(1000);

  for (const p of profiles) {
    await sh(`wm size ${p.width}x${p.height}`);
    await sh(`wm density ${p.density}`);
    for (const f of FONTS) {
      await envSet(serial, "font", [String(f)]);
      await sh("logcat -c");
      await start();
      await sleep(1000);
      const size = { width: p.width, height: p.height };
      for (const kind of ["list", "editor"]) {
        console.log(`  ${p.name} ${f} ${kind}: capturing`);
        if (kind === "editor") { await tap(serial, { id: "fab" }); await sleep(1500); }
        const base = join(out, `${p.name}-${f.toFixed(1)}-${kind}`);
        const scr = await screen(serial, `${base}.png`);
        const ell = await ellipsisNow(serial);
        if (f === 1.0) for (const n of scr.nodes.filter((x) => x.clickable && x.text)) baseline.set(`${kind}|${n.text}`, h(n));
        const missing = await unreachableLabels(serial, scr.nodes, size, kind);
        const { fails, ratios } = judge(scr.nodes, size, kind, baseline, ell, missing);
        writeFileSync(`${base}.json`, JSON.stringify({ profile: p.name, font: f, kind, screen: size, density: p.density, ellipsis: ell, ratios, fails, unreachable: missing, focus: scr.focus, nodes: scr.nodes }, null, 1));
        summary.push({ profile: p.name, font: f, kind, ratios, ellipsis: ell, fails });
        for (const x of fails) failures.push(`${p.name} font ${f} ${kind}: ${x}`);
        console.log(`${p.name} ${f} ${kind}: ${fails.length ? "FAIL" : "ok"}`);
      }
    }
  }
} finally {
  if (serial) await envSet(serial, "font", ["1.0"]).catch((e) => console.error(`font reset: ${e.message}`));
  await down().catch((e) => console.error(`down: ${e.message}`));
}
writeFileSync(join(out, "summary.json"), JSON.stringify({ static: s, wrapFactor: WRAP_FACTOR, captures: summary }, null, 1));
const all = [...s.bad, ...failures];
if (all.length) {
  console.error(`FAIL: ${all.length} layout problem(s)\n${all.map((x) => `  ${x}`).join("\n")}`);
  process.exit(1);
}
console.log(`OK: layout holds on ${PROFILES.length} profiles x ${FONTS.length} font scales (${summary.length} captures)`);
