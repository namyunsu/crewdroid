// usage: node scripts/check-up.mjs [<up.json>]   (no file: boots `up --count 3` itself)
// Exit 0 only if: every device has an emulator serial, booted, got its profile's wm size/density and distinct ids;
// no profile+API pair repeats while count <= profile count; with 2+ devices, at least 2 profiles and 2 APIs are mixed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// no argument: boot `up --count 3` itself, check it, then down
let file = process.argv[2];
if (!file) {
  const run = (...a) => spawnSync("npx", ["tsx", "src/cli.ts", ...a, "--json"], { cwd: join(import.meta.dirname, ".."), encoding: "utf8", shell: true, env: { ...process.env, CREWDROID_OWNER: String(process.pid) } });
  try {
    const r = run("up", "--count", "3");
    if (r.status !== 0) { console.error(`FAIL: up --count 3 exited ${r.status}\n${r.stderr}`); process.exit(1); }
    file = join(mkdtempSync(join(tmpdir(), "check-up-")), "up.json");
    writeFileSync(file, r.stdout);
  } finally { run("down"); }
}
const d = JSON.parse(readFileSync(file, "utf8"));
const nProfiles = JSON.parse(readFileSync(new URL("../profiles/galaxy.json", import.meta.url), "utf8")).profiles.length;
const devs = d.devices ?? [];
const errs = [];
if (!devs.length || devs.length !== d.count) errs.push(`want ${d.count} devices, got ${devs.length}`);
for (const x of devs) {
  if (!/^emulator-\d+$/.test(x.serial)) errs.push(`bad serial ${x.serial}`);
  if (!(x.bootSeconds > 0)) errs.push(`${x.serial}: no boot time`);
  // effective value = the last line ("Override ..." when set, else "Physical ..." — Android prints no override equal to physical)
  const last = (t, re) => [...String(t).matchAll(re)].at(-1)?.[1];
  if (last(x.wmSize, /size: (\d+x\d+)/g) !== `${x.width}x${x.height}`) errs.push(`${x.serial}: wm size '${x.wmSize}' != ${x.width}x${x.height}`);
  if (last(x.wmDensity, /density: (\d+)/g) !== String(x.density)) errs.push(`${x.serial}: wm density '${x.wmDensity}' != ${x.density}`);
  if (x.distinctNotes?.length) errs.push(`${x.serial}: makeDistinct notes ${x.distinctNotes.join("; ")}`);
}
const pairs = devs.map((x) => `${x.profile}@${x.api}`);
if (devs.length <= nProfiles && new Set(pairs).size < pairs.length) errs.push(`repeated profile+API: ${pairs}`);
if (devs.length >= 2 && (new Set(devs.map((x) => x.profile)).size < 2 || new Set(devs.map((x) => x.api)).size < 2)) errs.push(`not mixed: ${pairs}`);
if (errs.length) { console.error("FAIL:\n" + errs.join("\n")); process.exit(1); }
console.log(`OK: ${devs.length} devices ${devs.map((x) => `${x.serial}=${x.profile}@API${x.api}`).join(" ")}`);
