# MVP: private-app `techs.multi.ts` on crewdroid (T11)

`node scripts/mvp-private-app.mjs --runs 3` — raw: `mvp.json`, old path devices: `baseline.json` (T01). Date 2026-10-23.
private-app unchanged: its global-setup runs `avd-up.ps1`, which kills only `old-avd-*` emulators and skips booting a port that is already a device, so the crewdroid instances on 5570/5572/5574 only get the APK installed.

## Devices

| | Old path (avd-up.ps1) | crewdroid |
|---|---|---|
| Devices | old-avd-1..3, google_apis API 33, all 1080x2340 | s24ultra 1080x2340@450 API 34<br>fold5-main 1812x2176@420 API 34<br>flip7-main 1080x2520@480 API 36 |
| Disk (AVD dirs + system images, each once) | 24.73 GiB | 20.43 GiB |
| Boot (launch -> boot_completed) | 31.6 / 27.4 / 23.3 s (cold) | 9.6 / 6.4 / 6.3 s (snapshot); ready incl. identity + wm 36.2 / 32.6 / 33.7 s |
| Host RAM (sum, after 60 s idle) | 8453 MB | 9909 MB |
| Host CPU (sum, 60 s idle, 100 % = 1 core) | 1000 % | 148 % |

## Spec `npm run e2e:multi -- --grep @techs`

| | Old path | crewdroid |
|---|---|---|
| Pass count | 2/2 (records: `private-app/.ai-log/evidence/T29-1.txt`, `private-app/.ai-log/evidence/T29-verify.txt`) | 3/3 in a row |
| Test time (Playwright) | 96 / 40.8 s | 51.3 / 35.2 / 35.3 s (avg 40.6) |
| Spec wall time (Playwright total incl. global-setup: APK build + install + server; old path also boots the 3 AVDs there) | 198 / 108 s | 72 / 56.6 / 57 s (npm run end to end: 72.6 / 57.3 / 57.7 s) |
| Emulator CPU during the spec (sum, avg) | not measured | 415.1 / 243.4 / 255.6 % |

Old path not re-run: `avd-up.ps1` line 74 boots old-avd-1..3 without `-read-only`, and crewdroid must only launch them read-only. Old device numbers come from T01 (same emulator flags plus `-read-only`, fresh boots).
Demo: `docs/demo/techs.gif` (2.1 MB, 480 px high, 8 fps) — run 1, the 3 devices side by side (screenrecord with timestamp overlay).
