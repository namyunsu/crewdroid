import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Minimal upload receiver (grows in T07). POST /upload stores the raw multipart body and answers {"bytes":N}.
export function startServer(port: number, dir = join(import.meta.dirname, "data")) {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/upload") { res.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      writeFileSync(join(dir, `upload-${Date.now()}-${n++}.bin`), body);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ bytes: body.length }));
    });
  });
  return new Promise<typeof server>((ok) => server.listen(port, "0.0.0.0", () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 5599);
  await startServer(port);
  console.log(`upload server on :${port}`);
}
