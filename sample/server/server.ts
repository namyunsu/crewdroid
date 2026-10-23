import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp } from "./app.ts";

// Kept for check-atd.mjs: one sample server now (app.ts). Upload receiver = POST /upload there.
export function startServer(port: number, dir = join(import.meta.dirname, "data")) {
  return startApp({ port, dir });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 5599);
  await startServer(port);
  console.log(`sample server on :${port}`);
}
