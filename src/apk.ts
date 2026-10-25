import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import { buildTool } from "./sdk.ts";
import type { Tool } from "./mcp.ts";

const run = promisify(execFile);

interface El { tag: string; attrs: Record<string, string>; kids: El[] }

// `aapt2 dump xmltree --file AndroidManifest.xml` -> element tree. Depth comes from the indent width (aapt2's indent steps are uneven).
export function parseXmltree(text: string): El {
  const root: El = { tag: "#root", attrs: {}, kids: [] };
  const stack: { indent: number; el: El }[] = [{ indent: -1, el: root }];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\s*)([EA]): (.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    if (m[2] === "E") {
      while (stack.at(-1)!.indent >= indent) stack.pop();
      const el: El = { tag: m[3].split(" ")[0], attrs: {}, kids: [] };
      stack.at(-1)!.el.kids.push(el);
      stack.push({ indent, el });
    } else {
      // e.g. `http://schemas.android.com/apk/res/android:name(0x01010003)="x" (Raw: "x")`, `package="x"`, `...:minSdkVersion(0x..)=31`
      const eq = m[3].indexOf("=");
      const key = m[3].slice(0, eq).replace(/\(0x[0-9a-f]+\)$/i, "").split(":").pop()!;
      const v = m[3].slice(eq + 1);
      stack.at(-1)!.el.attrs[key] = v.startsWith('"') ? (v.match(/^"(.*?)"(?: \(Raw|$)/)?.[1] ?? v.slice(1)) : v.split(" ")[0];
    }
  }
  return root;
}

const kids = (e: El | undefined, tag: string) => e?.kids.filter((k) => k.tag === tag) ?? [];
const names = (e: El, tag: string) => kids(e, tag).map((k) => k.attrs.name);

export function manifestInfo(text: string) {
  const man = kids(parseXmltree(text), "manifest")[0];
  if (!man) throw new Error("no <manifest> element in aapt2 output");
  const sdk = kids(man, "uses-sdk")[0]?.attrs ?? {};
  const app = kids(man, "application")[0];
  const acts = [...kids(app, "activity"), ...kids(app, "activity-alias")];
  const exportedActivities: string[] = [];
  const deepLinks: { activity: string; autoVerify: boolean; browsable: boolean; schemes: string[]; hosts: string[]; paths: string[] }[] = [];
  for (const a of acts) {
    const filters = kids(a, "intent-filter");
    // no android:exported + an intent-filter = exported (pre-API 31 default; API 31+ refuses to install such an APK)
    if (a.attrs.exported === "true" || (a.attrs.exported === undefined && filters.length)) exportedActivities.push(a.attrs.name);
    for (const f of filters) {
      const data = kids(f, "data").map((d) => d.attrs);
      if (!names(f, "action").includes("android.intent.action.VIEW") || !data.some((d) => d.scheme)) continue;
      const pick = (...k: string[]) => [...new Set(data.flatMap((d) => k.map((x) => d[x]).filter(Boolean)))];
      deepLinks.push({
        activity: a.attrs.name, autoVerify: f.attrs.autoVerify === "true", browsable: names(f, "category").includes("android.intent.category.BROWSABLE"),
        schemes: pick("scheme"), hosts: pick("host"), paths: pick("path", "pathPrefix", "pathPattern", "pathSuffix", "pathAdvancedPattern"),
      });
    }
  }
  const num = (s?: string) => (s === undefined ? null : Number(s));
  return {
    package: man.attrs.package, versionName: man.attrs.versionName ?? null, versionCode: num(man.attrs.versionCode),
    minSdk: num(sdk.minSdkVersion), targetSdk: num(sdk.targetSdkVersion),
    permissions: [...names(man, "uses-permission"), ...names(man, "uses-permission-sdk-23")],
    exportedActivities, deepLinks,
  };
}

// Host only: no device needed.
export async function apk(file: string) {
  if (!existsSync(file)) throw new Error(`apk not found: ${file}`);
  const { stdout } = await run(buildTool("aapt2"), ["dump", "xmltree", "--file", "AndroidManifest.xml", file], { windowsHide: true, maxBuffer: 64 << 20 });
  return { file, ...manifestInfo(stdout) };
}

export const mcpTools: Tool[] = [{
  name: "apk", description: "Read an APK's manifest on the host (aapt2): package, version, min/target SDK, permissions, exported activities, deep-link filters.",
  input: { file: z.string().describe("path to the .apk on the host") },
  run: (a) => apk(a.file),
}];
