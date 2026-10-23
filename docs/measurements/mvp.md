# MVP: private-app `techs.multi.ts` on crewdroid (T11)

`node scripts/mvp-private-app.mjs --runs 3` — raw: `mvp.json`, old path devices: `baseline.json` (T01). Date 2026-10-23.
private-app unchanged: its global-setup runs `avd-up.ps1`, which kills only `old-avd-*` emulators and skips booting a port that is already a device, so the crewdroid instances on 5570/5572/5574 only get the APK installed.

## Devices

| | Old path (avd-up.ps1) | crewdroid |
|---|---|---|
| Devices | old-avd-1..3, google_apis API 33, all 1080x2340 | s22 1080x2340@480 API 31<br>fold5-main 1812x2176@420 API 34<br>flip7-main 1080x2520@480 API 36 |
| Disk (AVD dirs + system images, each once) | 24.73 GiB | 38.63 GiB |
| Boot (launch -> boot_completed) | 31.6 / 27.4 / 23.3 s (cold) | 9.1 / 6.1 / 31.4 s (snapshot); ready incl. identity + wm 33.8 / 33.8 / 58.6 s |
| Host RAM (sum, after 60 s idle) | 8453 MB | 9237 MB |
| Host CPU (sum, 60 s idle, 100 % = 1 core) | 1000 % | 97 % |

## Spec `npm run e2e:multi -- --grep @techs`

| | Old path | crewdroid |
|---|---|---|
| Pass count | 2/2 (records: `private-app/.ai-log/evidence/T29-1.txt`, `private-app/.ai-log/evidence/T29-verify.txt`) | 3/3 in a row |
| Test time (Playwright) | 96 / 40.8 s | 37 / 34.9 / 34.5 s (avg 35.5) |
| Spec wall time (Playwright total incl. global-setup: APK build + install + server; old path also boots the 3 AVDs there) | 198 / 108 s | 59.6 / 56 / 55.5 s (npm run end to end: 60.3 / 56.7 / 56.2 s) |
| Emulator CPU during the spec (sum, avg) | not measured | 304.8 / 206 / 219.4 % |

Old path not re-run: `avd-up.ps1` line 74 boots old-avd-1..3 without `-read-only`, and crewdroid must only launch them read-only. Old device numbers come from T01 (same emulator flags plus `-read-only`, fresh boots).
Demo: `docs/demo/techs.gif` (1.3 MB, 480 px high, 8 fps) — run 1, the 3 devices side by side (screenrecord with timestamp overlay).
