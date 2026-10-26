// T38 verify: node scripts/check-input.mjs [--base-port 5580]
// Boots 1 device on API 34 + 1 on API 36, opens the probe's check=form and drives it only through the CLI (shot, tap, type,
// swipe, key) plus MCP `shot` over the stdio SDK client. Always downs its emulators.
import { execFile } from "node:child_process";
import { inflateSync } from "node:zlib";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { down, up } from "../src/up.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" } } });
const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const tmp = mkdtempSync(join(tmpdir(), "crewinput-"));
const errs = [];
const claim = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const crew = (cmd, ...args) => new Promise((ok) => execFile(process.execPath, ["--import", "tsx", cli, cmd, "--json", ...args], { windowsHide: true, maxBuffer: 64 << 20 }, (e, out, err) => {
  let json = null;
  try { json = JSON.parse(out || err); } catch { json = null; }
  ok({ code: e ? e.code ?? 1 : 0, json, err: String(err).trim().slice(0, 300) });
}));

// Minimal PNG decoder (8-bit RGB/RGBA, as screencap writes): size + whether every pixel has the same colour.
function png(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), depth = buf[24], ct = buf[25];
  if (depth !== 8 || (ct !== 6 && ct !== 2)) throw new Error(`unsupported PNG depth ${depth} colour type ${ct}`);
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, idat = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o), t = buf.toString("latin1", o + 4, o + 8);
    if (t === "IDAT") idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[dst + x] = (raw[src + x] + pred) & 255;
    }
  }
  const colours = new Set();
  for (let i = 0; i < w * h && colours.size < 2; i += 7) colours.add(px.readUIntBE(i * bpp, 3));
  return { width: w, height: h, oneColour: colours.size < 2 };
}
const wmSize = (s) => (s.match(/Override size: (\d+x\d+)/) ?? s.match(/Physical size: (\d+x\d+)/))?.[1];
const probeLog = async (s) => ((await crew("logs", s, PKG, "--since", "3m")).json?.lines ?? []).filter((l) => l.tag === "CrewProbe").map((l) => l.message);

let client;
try {
  await down();
  const r = await up(2, Number(v["base-port"]), ["s24ultra", "flip7-main"]);
  claim(r.devices.map((d) => d.api).join(",") === "34,36", `devices: ${r.devices.map((d) => `${d.serial} API ${d.api} ${d.wmSize.replace(/\s+/g, " ")}`).join(" | ")}`);
  client = new Client({ name: "check-input", version: "0.0.1" });
  // the SDK client passes only a few env vars by default; the server needs ANDROID_HOME the way a real MCP client hands it over
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", cli, "mcp"], env: process.env }));
  const tools = (await client.listTools()).tools.map((t) => t.name);
  claim(["shot", "tap", "type", "swipe", "key"].every((n) => tools.includes(n)), `MCP lists shot, tap, type, swipe, key`);

  for (const d of r.devices) {
    const s = d.serial, size = wmSize(d.wmSize), tag = `${s} API ${d.api}`;
    let x = await crew("install", s, probeApk());
    x = await crew("launch", s, PKG, "--restart", "--", "--es", "check", "form");
    claim(x.code === 0 && x.json?.crashed === false, `${tag} launch check=form`);

    x = await crew("shot", s);
    const file = x.json?.path;
    const img = file ? png(readFileSync(file)) : null;
    if (file) rmSync(file, { force: true }); // default name lands in the cwd
    claim(x.code === 0 && /crewdroid-emulator-\d+-\d{8}-\d{6}\.png$/.test(file) && `${x.json.width}x${x.json.height}` === size && `${img.width}x${img.height}` === size && !img.oneColour && x.json.blackRelaunch?.black === false,
      `${tag} shot -> ${file} ${img?.width}x${img?.height} (wm size ${size}) oneColour=${img?.oneColour} blackRelaunch=${JSON.stringify(x.json?.blackRelaunch)}`);

    const m = await client.callTool({ name: "shot", arguments: { serial: s, file: join(tmp, `mcp-${s}.png`) } });
    const im = m.content?.find((c) => c.type === "image"), tx = m.content?.find((c) => c.type === "text");
    const dec = im ? png(Buffer.from(im.data, "base64")) : null;
    claim(m.isError === false && im?.mimeType === "image/png" && `${dec?.width}x${dec?.height}` === size && !dec.oneColour && tx?.text.endsWith(size),
      `${tag} MCP shot: image ${dec?.width}x${dec?.height} oneColour=${dec?.oneColour}, text "${tx?.text}"`);

    const text = "hello world & 100%";
    x = await crew("type", s, text, "--into", "name");
    claim(x.code === 0 && /:id\/name$/.test(x.json?.into?.id ?? ""), `${tag} type --into name: into ${x.json?.into?.id} ${x.err}`);
    x = await crew("tap", s, "--text", "Send");
    claim(x.code === 0 && x.json?.node?.text === "Send", `${tag} tap --text Send at ${x.json?.x},${x.json?.y} ${x.err}`);
    await sleep(1000);
    let log = await probeLog(s);
    claim(log.includes(`FORM ${text}`), `${tag} log has "FORM ${text}": ${JSON.stringify(log)}`);

    x = await crew("type", s, "안녕", "--into", "name");
    if (x.code === 0) {
      await crew("tap", s, "--text", "Send"); await sleep(1000);
      log = await probeLog(s);
      claim(log.some((l) => l.endsWith("안녕")), `${tag} non-ASCII: typed, log ${JSON.stringify(log.at(-1))}`);
    } else claim(x.code === 1 && /non-ASCII/.test(x.json?.error ?? ""), `${tag} non-ASCII: exit 1 with the documented reason (RECORDED: not typed): ${x.json?.error}`);

    x = await crew("tap", s, "--text", "Nothing");
    claim(x.code === 1 && /no match for text 'Nothing'/.test(x.json?.error ?? ""), `${tag} tap --text Nothing exits 1: ${(x.json?.error ?? "").split("\n").slice(0, 3).join(" | ")}`);

    x = await crew("swipe", s, "up", "--times", "6");
    await sleep(1000);
    log = await probeLog(s);
    claim(x.code === 0 && log.includes("SCROLL END"), `${tag} swipe up --times 6 (${x.json?.from} -> ${x.json?.to}) -> SCROLL END: ${log.includes("SCROLL END")}`);

    x = await crew("key", s, "back");
    claim(x.code === 0 && x.json?.key === "KEYCODE_BACK" && !x.json.focus.includes("ProbeActivity"), `${tag} key back leaves the probe: focus '${x.json?.focus}'`);

    x = await crew("tap", s, "99999", "1");
    claim(x.code === 1 && /outside the screen/.test(x.json?.error ?? ""), `${tag} tap 99999 1 exits 1: ${x.json?.error}`);
  }
} finally {
  await client?.close().catch(() => {});
  await down().catch((e) => console.log(`down failed: ${e.message}`));
  rmSync(tmp, { recursive: true, force: true });
}
if (errs.length) { console.log(`FAIL: ${errs.length} claims failed`); process.exit(1); }
console.log("OK: shot, tap, type, swipe and key claims hold");
