# Single-device `up` (FR-27)

Date: 2026-10-27. `crewdroid up` with no flags = 1 device, s24ultra, newest installed google_atd API <= 36 (API 36; installed: 31, 34, 36). Each run is cold: `down` first, snapshot already prepared.

| Run | boot (s, to sys.boot_completed) | ready (s, after wm size/density + identity) | wall incl. node start (s) |
|---|---|---|---|
| 1 | 5.6 | 7.4 | 8.4 |
| 2 | 6.1 | 8.7 | 9.8 |
| 3 | 5.6 | 7.3 | 8.3 |
| mean | 5.8 | 7.8 | 8.8 |

Phases (s since launch at the end of each step; snapshot load from the emulator log):

| Run | image | snapshot load | adbDevice | bootCompleted | hwui | root | identity | wm |
|---|---|---|---|---|---|---|---|---|
| 1 | API 36 | 0.979 | 5.5 | 5.6 | 5.7 | 5.8 | 5.8 | 7.1 |
| 2 | API 36 | 0.966 | 6 | 6.1 | 6.2 | 6.3 | 6.3 | 8.4 |
| 3 | API 36 | 0.926 | 5.5 | 5.6 | 5.7 | 5.8 | 5.8 | 7.1 |
| --api 34 | API 34 | 0.963 | 5.5 | 5.6 | 5.6 | 5.7 | 5.7 | 7.4 |

A single device skips makeDistinct (framework restart + probe reinstall, ~27 s; only clones side by side need distinct ids) and the fixed 8 s around `adb root` (the snapshot is saved with adbd root) (T42).

Idle host cost of the one device (run 3, 60 s idle): RAM 1455 MB working set, CPU 206.7% of one core.

Other checks: `devices` shows it booted; `up --api 31` -> API 31; `up --api 99` exits 1 listing the installed APIs (31, 34, 36).
