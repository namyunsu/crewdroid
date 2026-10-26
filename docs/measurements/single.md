# Single-device `up` (FR-27)

Date: 2026-10-26. `crewdroid up` with no flags = 1 device, s24ultra, newest installed google_atd API <= 36 (API 36; installed: 31, 34, 36). Each run is cold: `down` first, snapshot already prepared.

| Run | boot (s, to sys.boot_completed) | ready (s, after wm size/density + identity) | wall incl. node start (s) |
|---|---|---|---|
| 1 | 5.5 | 7.8 | 8.8 |
| 2 | 5.6 | 7 | 8 |
| 3 | 5.5 | 7.8 | 8.9 |
| mean | 5.5 | 7.5 | 8.6 |

Phases (s since launch at the end of each step; snapshot load from the emulator log):

| Run | image | snapshot load | adbDevice | bootCompleted | hwui | root | identity | wm |
|---|---|---|---|---|---|---|---|---|
| 1 | API 36 | 0.919 | 5.5 | 5.5 | 5.6 | 5.7 | 5.7 | 7.3 |
| 2 | API 36 | 0.94 | 5.5 | 5.6 | 5.6 | 5.7 | 5.7 | 6.5 |
| 3 | API 36 | 0.925 | 5.4 | 5.5 | 5.6 | 5.7 | 5.7 | 7.5 |
| --api 34 | API 34 | 0.925 | 5.5 | 5.6 | 5.6 | 5.7 | 5.7 | 7.6 |

A single device skips makeDistinct (framework restart + probe reinstall, ~27 s; only clones side by side need distinct ids) and the fixed 8 s around `adb root` (the snapshot is saved with adbd root) (T42).

Idle host cost of the one device (run 3, 60 s idle): RAM 1457 MB working set, CPU 221.2% of one core.

Other checks: `devices` shows it booted; `up --api 31` -> API 31; `up --api 99` exits 1 listing the installed APIs (31, 34, 36).
