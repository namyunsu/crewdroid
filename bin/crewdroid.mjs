#!/usr/bin/env node
// AI NOTE: Node does not strip types for files under node_modules, so npx needs tsx to run src/*.ts.
import { register } from "tsx/esm/api";
register();
await import("../src/cli.ts");
