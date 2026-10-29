// T76: what the google_atd images lack, measured. node scripts/check-atd-limits.mjs [--apis 34] [--write] [--base-port 5580] [--server-port 5597]
// Boots one fresh crew device per API (one at a time), records the WebView provider, whether an app WebView renders a local
// page (probe check=webview against a tiny host server), which activity resolves the intents apps hand to other apps, and
// whether Play services / Play Store / Chrome are installed.
// --write (with --apis 31,34,36): writes docs/measurements/atd-limits.json + .md. Without it: re-measures the given APIs and
// fails if docs/measurements/atd-limits.md disagrees with the fresh numbers.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { down, up } from "../src/up.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";

const { values: v } = parseArgs({ options: { apis: { type: "string", default: "34" }, write: { type: "boolean", default: false }, "base-port": { type: "string", default: "5580" }, "server-port": { type: "string", default: "5597" } } });
const root = join(import.meta.dirname, "..");
const jsonFile = join(root, "docs/measurements/atd-limits.json"), mdFile = join(root, "docs/measurements/atd-limits.md");
const apis = v.apis.split(",").map(Number), SP = Number(v["server-port"]);
const TITLE = "crewdroid webview page";

const INTENTS = {
  "VIEW https://example.com": ["-a", "android.intent.action.VIEW", "-c", "android.intent.category.BROWSABLE", "-d", "https://example.com"],
  "IMAGE_CAPTURE": ["-a", "android.media.action.IMAGE_CAPTURE"],
  "MAIN/HOME": ["-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME"],
  "SEND text/plain": ["-a", "android.intent.action.SEND", "-t", "text/plain"],
  "PICK_IMAGES": ["-a", "android.provider.action.PICK_IMAGES"],
  "VIEW market://details": ["-a", "android.intent.action.VIEW", "-d", "market://details?id=com.example"],
  "ADD_ACCOUNT_SETTINGS": ["-a", "android.settings.ADD_ACCOUNT_SETTINGS"],
};
const PACKAGES = ["com.google.android.gms", "com.android.vending", "com.android.chrome"];

let hits = 0;
const server = createServer((_, res) => { hits++; res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><title>${TITLE}</title><h1>${TITLE}</h1>`); });
await new Promise((ok) => server.listen(SP, "0.0.0.0", ok));
execFileSync(join(root, "probe-app", process.platform === "win32" ? "gradlew.bat" : "gradlew"), ["assembleDebug", "--console=plain", "-q"], { cwd: join(root, "probe-app"), stdio: "inherit", shell: process.platform === "win32" });

async function measure(api) {
  await down();
  const r = await up(1, Number(v["base-port"]), ["s22"], false, { api });
  const s = r.devices[0].serial, sh = (...a) => adb(s, ["shell", ...a], 60000).catch((e) => String(e.message));
  const wvu = await sh("dumpsys", "webviewupdate");
  const cur = wvu.match(/Current WebView package \(name, version\): \(([^,]+), ([^)]+)\)/);
  const valid = [...wvu.matchAll(/Valid package ([\w.]+) \(versionName: ([^,]+),/g)].map((m) => `${m[1]} ${m[2]}`);
  await adb(s, ["install", "-r", probeApk()], 120000);
  await adb(s, ["logcat", "-c"]);
  const before = hits;
  await sh("am", "start", "-n", `${PKG}/.ProbeActivity`, "--es", "check", "webview", "--es", "url", `http://10.0.2.2:${SP}/`);
  let line = "";
  for (let i = 0; i < 30 && !line; i++) {
    await sleep(1000);
    line = (await adb(s, ["logcat", "-d", "-s", "CrewProbe:I"]).catch(() => "")).split(/\r?\n/).find((l) => l.includes("WEBVIEW")) ?? "";
  }
  const result = line.replace(/^.*CrewProbe\s*:\s*WEBVIEW\s*/, "").trim() || "no WEBVIEW line in 30 s";
  const intents = {};
  const comps = (out) => out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[\w.]+\/[\w.$]+$/.test(l));
  for (const [k, a] of Object.entries(INTENTS)) {
    // NOTE: --brief prints a "priority=..." line then the component; several handlers resolve to the system chooser
    // (android/com.android.internal.app.ResolverActivity), so query-activities lists who would be offered.
    const resolves = comps(await sh("cmd", "package", "resolve-activity", "--brief", ...a))[0] ?? "none";
    intents[k] = { resolves, handlers: comps(await sh("cmd", "package", "query-activities", "--brief", ...a)) };
  }
  const pkgs = {};
  for (const p of PACKAGES) {
    const dump = (await sh(`dumpsys package ${p} | grep -E 'codePath=|versionName='`)).trim();
    pkgs[p] = (await sh("pm", "path", p)).includes("package:") ? { codePath: dump.match(/codePath=(\S+)/)?.[1], versionName: dump.match(/versionName=(.+)/)?.[1].trim() } : null;
  }
  const accounts = Number((await sh("dumpsys", "account")).match(/Accounts: (\d+)/)?.[1] ?? -1);
  return { api, serial: s, accounts, webview: { provider: cur?.[1] ?? "none", version: cur?.[2] ?? "none", valid, renders: result.startsWith("ok"), result, hostRequests: hits - before }, intents, packages: pkgs };
}

const intent = (x) => x.resolves === "none" ? "nothing" : /ResolverActivity/.test(x.resolves) ? `chooser: ${x.handlers.map((h) => `\`${h}\``).join(", ")}` : `\`${x.resolves}\``;
function md(data) {
  const rows = data.devices;
  const col = (f) => rows.map(f).join(" | ");
  const L = [
    "# What the google_atd images lack (T76)",
    "",
    `Date: ${data.date.slice(0, 10)} · raw: \`atd-limits.json\` · script: \`node scripts/check-atd-limits.mjs --apis 31,34,36 --write\` (re-check one API: \`node scripts/check-atd-limits.mjs\`)`,
    `Each API on a fresh crew device (profile s22, one device at a time). WebView check: the probe app's \`check=webview\` loads \`http://10.0.2.2:<port>/\` from a tiny host server (title "${TITLE}"). Intents: \`cmd package resolve-activity --brief\`; packages: \`pm path\`.`,
    "",
    `| | ${col((d) => `API ${d.api}`)} |`,
    `|---|${rows.map(() => "---").join("|")}|`,
    `| WebView provider (\`dumpsys webviewupdate\`) | ${col((d) => `\`${d.webview.provider}\` ${d.webview.version}`)} |`,
    `| App WebView renders a local page | ${col((d) => `${d.webview.renders ? "yes" : "no"} (\`${d.webview.result}\`)`)} |`,
    ...Object.keys(INTENTS).map((k) => `| \`${k}\` resolves to | ${col((d) => intent(d.intents[k]))} |`),
    ...PACKAGES.map((p) => `| \`${p}\` installed | ${col((d) => (d.packages[p] ? `yes, \`${d.packages[p].codePath}\` ${d.packages[p].versionName}` : "no"))} |`),
    `| Accounts on the device (\`dumpsys account\`) | ${col((d) => String(d.accounts))} |`,
    "",
  ];
  return L.join("\n");
}

const fails = [];
try {
  const fresh = [];
  for (const api of apis) { const m = await measure(api); console.log(JSON.stringify(m)); fresh.push(m); }
  if (v.write) {
    const data = { date: new Date().toISOString(), method: "fresh crew device per API (profile s22), one at a time; see atd-limits.md", devices: fresh.map(({ serial, ...d }) => d) };
    writeFileSync(jsonFile, JSON.stringify(data, null, 2) + "\n");
    writeFileSync(mdFile, md(data));
    console.log(`wrote ${jsonFile} and ${mdFile}`);
  } else {
    const data = JSON.parse(readFileSync(jsonFile, "utf8"));
    for (const m of fresh) {
      const i = data.devices.findIndex((d) => d.api === m.api);
      if (i < 0) { fails.push(`API ${m.api} not in atd-limits.json`); continue; }
      const { serial, ...d } = m;
      data.devices[i] = d;
    }
    const want = md(data).split("\n").slice(3), have = readFileSync(mdFile, "utf8").split("\n").slice(3); // skip title + date line
    for (let i = 0; i < Math.max(want.length, have.length); i++) if (want[i] !== have[i]) fails.push(`atd-limits.md line ${i + 4}:\n  md:    ${have[i]}\n  fresh: ${want[i]}`);
  }
} finally {
  await down().catch((e) => console.log(`down failed: ${e.message}`));
  server.close();
}
if (fails.length) { console.log(fails.map((f) => "FAIL: " + f).join("\n")); process.exit(1); }
console.log(`OK: atd-limits ${v.write ? "written" : "md matches a fresh measurement"} for API ${apis.join(",")}`);
process.exit(0);
