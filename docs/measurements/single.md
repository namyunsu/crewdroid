# Single-device `up` (FR-27)

Date: 2026-10-26. `crewdroid up` with no flags = 1 device, s24ultra, newest installed google_atd API <= 36 (API 36; installed: 31, 34, 36). Each run is cold: `down` first, snapshot already prepared.

| Run | boot (s, to sys.boot_completed) | ready (s, after wm size/density + identity) | wall incl. node start (s) |
|---|---|---|---|
| 1 | 5.6 | 7.4 | 8.4 |
| 2 | 5.6 | 7.3 | 8.3 |
| 3 | 5.5 | 7.1 | 8.1 |
| mean | 5.6 | 7.3 | 8.3 |

Phases (s since launch at the end of each step; snapshot load from the emulator log):

| Run | image | snapshot load | adbDevice | bootCompleted | hwui | root | identity | wm |
|---|---|---|---|---|---|---|---|---|
| 1 | API 36 | 0.957 | 5.5 | 5.6 | 5.6 | 5.7 | 5.7 | 7 |
| 2 | API 36 | 0.912 | 5.5 | 5.6 | 5.7 | 5.8 | 5.8 | 6.9 |
| 3 | API 36 | 0.911 | 5.5 | 5.5 | 5.6 | 5.7 | 5.7 | 6.8 |
| --api 34 | API 34 | 0.907 | 5.5 | 5.6 | 5.7 | 5.7 | 5.7 | 7.9 |

A single device skips makeDistinct (framework restart + probe reinstall, ~27 s; only clones side by side need distinct ids) and the fixed 8 s around `adb root` (the snapshot is saved with adbd root) (T42).

Idle host cost of the one device (run 3, 60 s idle): RAM 1455 MB working set, CPU 220% of one core.

Other checks: `devices` shows it booted; `up --api 31` -> API 31; `up --api 99` exits 1 listing the installed APIs (31, 34, 36).
