import { judge } from "./judge.ts";

export interface HammerOptions {
  url: string; users: number; repeat: number; jitter?: number; retryRate?: number; seed?: number; rules?: string; records?: number;
}

// mulberry32: small seeded PRNG so the same seed gives the same per-user decisions (delays, retries, record picks).
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export async function hammer(o: HammerOptions) {
  const { url, users, repeat, jitter = 50, retryRate = 0.1, seed = 1, rules = "judge/sample.rules.json", records = 5 } = o;
  const base = url.replace(/\/$/, "");
  const stats = { requests: 0, errors: 0, conflicts: 0, retries: 0 };
  const req = async (path: string, init: RequestInit) => {
    stats.requests++;
    try {
      const r = await fetch(base + path, init);
      if (r.status >= 500 || r.status === 400) stats.errors++;
      return r;
    } catch { stats.errors++; return undefined; }
  };

  // No shared start signal: each user begins after its own random delay and keeps its own pace.
  async function user(u: number) {
    const rand = rng(seed * 100003 + u);
    const wait = () => sleep(rand() * jitter);
    const clientId = `u${u}`;
    const known = new Map<string, number>(); // last version this user saw per record
    await wait();
    for (let i = 0; i < repeat; i++) {
      const key = `${clientId}-${i}`;
      const upload = () => req("/upload", { method: "POST", headers: { "x-client-id": clientId, "idempotency-key": key }, body: `photo-${key}` });
      await upload();
      if (rand() < retryRate) { stats.retries++; await wait(); await upload(); } // client retry, same key
      await wait();
      const id = `rec${Math.floor(rand() * records)}`;
      for (let attempt = 0; attempt < 5; attempt++) {
        const r = await req(`/records/${id}`, { method: "PUT", body: JSON.stringify({ version: known.get(id) ?? 0, value: `${clientId}-${i}`, clientId }) });
        if (!r) break;
        const b = (await r.json().catch(() => ({}))) as { version?: number };
        if (r.status === 409 && typeof b.version === "number") { stats.conflicts++; known.set(id, b.version); continue; }
        if (r.ok && typeof b.version === "number") known.set(id, b.version);
        break;
      }
      await wait();
    }
  }

  const t0 = Date.now();
  await Promise.all(Array.from({ length: users }, (_, u) => user(u)));
  const seconds = (Date.now() - t0) / 1000;
  const j = await judge(rules, base);
  return { ...stats, seconds, throughput: +(stats.requests / seconds).toFixed(1), seed, judge: j };
}
