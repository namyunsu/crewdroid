// Designated-driver server. BUGGY=1: a slow ETA lookup sits between the "is it taken" check and the write, and accept and complete ignore idempotency keys.
import { createServer } from "node:http";
const buggy = process.env.BUGGY === "1";
const port = Number(process.argv[2] ?? 5596);
const FROM = ["강남역 3번출구", "홍대입구역", "서울역 서부", "잠실 롯데타워", "여의도 IFC", "부산 서면 롯데호텔 후문 택시승강장 앞", "판교역 1번출구"];
const TO = ["분당 정자동", "일산 주엽역", "인천 부평구청", "수원 영통구 매탄동 삼성디지털시티 정문 맞은편", "노원역", "의정부시청"];
const calls = new Map(), ledger = [], accepts = [], seen = new Map();
let n = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newCall = () => { n++; const id = "c" + n; calls.set(id, { id, from: FROM[n % FROM.length], to: TO[n % TO.length], fare: 15000 + (n * 3700) % 30000, version: 0, driverId: null }); };
const open = () => { let o = [...calls.values()].filter((c) => !c.driverId); while (o.length < 2) { newCall(); o = [...calls.values()].filter((c) => !c.driverId); } return o; };
const replay = (key) => (buggy ? null : seen.get(key));
const answer = (res, code, body, key) => { const s = JSON.stringify(body); if (key && code < 500) seen.set(key, [code, s]); res.writeHead(code, { "content-type": "application/json" }); res.end(s); };
createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const url = new URL(req.url, "http://x"), key = req.headers["idempotency-key"];
  const m = url.pathname.match(/^\/calls\/(\w+)\/driver$/), f = url.pathname.match(/^\/trips\/(\w+)\/complete$/);
  if (req.method === "GET" && url.pathname === "/calls") return answer(res, 200, { calls: open() });
  if (req.method === "GET" && url.pathname === "/export") return answer(res, 200, { accepts, ledger, calls: [...calls.values()] });
  if (req.method === "PUT" && m) {
    const hit = replay(key); if (hit) { res.writeHead(hit[0]); return res.end(hit[1]); }
    const c = calls.get(m[1]);
    if (!c) return answer(res, 404, {});
    if (buggy) { if (c.driverId) return answer(res, 409, { taken: true }); await sleep(800); }
    else if (c.driverId && c.driverId !== body.driverId) return answer(res, 409, { taken: true }, key);
    c.driverId = body.driverId; c.version++;
    accepts.push({ callId: c.id, driverId: body.driverId, name: body.name, at: Date.now() });
    return answer(res, 200, { id: c.id, driverId: c.driverId, version: c.version }, key);
  }
  if (req.method === "POST" && f) {
    const hit = replay(key); if (hit) { res.writeHead(hit[0]); return res.end(hit[1]); }
    ledger.push({ entry: ledger.length, tripKey: f[1] + "/" + body.driverId, callId: f[1], driverId: body.driverId, fare: body.fare, at: Date.now() });
    const earned = ledger.filter((l) => l.driverId === body.driverId).reduce((a, l) => a + l.fare, 0);
    return answer(res, 200, { earned, entry: ledger.length }, key);
  }
  answer(res, 404, {});
}).listen(port, "127.0.0.1", () => console.log(`daeri server :${port}${buggy ? " BUGGY" : ""}`));
