// usage: [BUGGY=1] [DATA_DIR=dir] npx tsx sample/server/main.ts [port=5599]
import { join } from "node:path";
import { startApp } from "./app.ts";

const port = Number(process.argv[2] ?? process.env.PORT ?? 5599);
const buggy = process.env.BUGGY === "1";
await startApp({ port, buggy, dir: process.env.DATA_DIR ?? join(import.meta.dirname, "data") });
console.log(`sample server on :${port}${buggy ? " (BUGGY)" : ""}`);
