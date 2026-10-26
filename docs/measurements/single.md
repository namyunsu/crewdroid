# Single-device `up` (FR-27)

Date: 2026-10-26. `crewdroid up` with no flags = 1 device, s24ultra, newest installed google_atd API <= 36 (API 36; installed: 31, 34, 36). Each run is cold: `down` first, snapshot already prepared.

| Run | boot (s, to sys.boot_completed) | ready (s, after wm size/density + identity) | wall incl. node start (s) |
|---|---|---|---|
| 1 | 48.3 | 107 | 108.1 |
| 2 | 49.2 | 102.4 | 103.4 |
| 3 | 49.3 | 95.1 | 96.2 |
| mean | 48.9 | 101.5 | 102.6 |

Idle host cost of the one device (run 3, 60 s idle): RAM 1344 MB working set, CPU 219.6% of one core.

Other checks: `devices` shows it booted; `up --api 31` -> API 31; `up --api 99` exits 1 listing the installed APIs (31, 34, 36).
