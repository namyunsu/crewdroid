// T83 verify: node scripts/check-wifi-retry.mjs [--api 34]
// One API 34 device booted like `up --wifi`: the marker guest property reads back; `net wifi`; forget the saved AndroidWifi
// network (forces the retry path of net.ts); `net wifi` again must report wifiRetry:true and default transport wifi.
// Always `down` at the end. Exit 0 only if every claim holds.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { down, up, upDefaults } from "../src/up.ts";

const { values: v } = parseArgs({ options: { api: { type: "string", default: "34" } } });
const cli = join(import.meta.dirname, "..", "src", "cli.ts");
const errs = [];
const claim = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const net = (serial, ...args) => new Promise((ok, fail) => execFile(process.execPath, [cli, "net", serial, ...args, "--json"], { windowsHide: true }, (e, out, err) => (e ? fail(new Error(err || String(e))) : ok(JSON.parse(out)))));

try {
  await down();
  const d = upDefaults({ api: Number(v.api) });
  const r = await up(d.count, 5580, d.names, false, { api: d.api, wifi: true });
  const s = r.devices[0].serial;
  const marker = (await adb(s, ["shell", "getprop", "debug.crewdroid.wifi"])).trim();
  claim(marker === "1", `up --wifi marker debug.crewdroid.wifi reads back "${marker}"`);
  const first = await net(s, "wifi");
  claim(first.transport.default === "wifi", `first net wifi: default ${first.transport.default}, wifiRetry ${first.wifiRetry ?? false}`);
  const list = await adb(s, ["shell", "cmd wifi list-networks"]).catch((e) => String(e));
  const id = list.split(/\r?\n/).map((l) => l.match(/^\s*(\d+)\s+AndroidWifi\b/)?.[1]).find(Boolean);
  claim(id !== undefined, `saved AndroidWifi network found in list-networks: id ${id}`);
  if (id !== undefined) await adb(s, ["shell", `cmd wifi forget-network ${id}`]);
  console.log(`list-networks after forget: ${(await adb(s, ["shell", "cmd wifi list-networks"]).catch((e) => String(e))).trim()}`);
  const second = await net(s, "wifi");
  claim(second.wifiRetry === true && second.transport.default === "wifi", `net wifi after forget-network: wifiRetry ${second.wifiRetry}, default ${second.transport.default}, settled ${second.settledSeconds} s`);
} catch (e) {
  claim(false, `error: ${e.stack ?? e}`);
} finally {
  await down().catch(() => {});
  console.log(errs.length ? `FAIL: ${errs.length} claim(s)` : "OK: wifi retry path runs when forced and ends on Wi-Fi");
  process.exit(errs.length ? 1 : 0);
}
