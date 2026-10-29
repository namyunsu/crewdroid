# Baseline: stock google_atd AVDs x3 (T70)

- Date: 2026-10-29 · raw: `baseline-atd.json` · script: `scripts/measure-stock.mjs` · n=6 rounds (fresh AVDs each round)
- PC: AMD Ryzen 7 5700X 8-Core Processor 16 threads, 64 GB RAM, win32 10.0.26300
- Emulator: 37.1.11.0 · images: the same `google_atd` images `up --count 3` uses (API 31, 34, 36)
- AVDs: `avdmanager create avd -d pixel_9`, default RAM/cores, fresh (never run before), launched `-avd <name> -port <port> -no-window (nothing else)`; 60 s idle sampling after all booted, 3 s launch stagger (as `measure --up 3`)
- RAM = WorkingSet64 (Get-Process); CPU % is of one core (100 % = 1 core); ready = boot_completed (stock has no extra setup steps)
- Disk, two metrics (AVD dir + system image, each image once): **allocated** = bytes really on disk (sparse holes and NTFS compression excluded, `allocBytes` as in slim.md; the metric of crewdroid's 6.99 GiB) and **logical** = summed file lengths (`dirBytes`; the metric of the old google_apis 24.74 GiB).

| Round | Disk allocated | Disk logical | Host RAM | Idle CPU | Boot / ready (API 31 / 34 / 36) |
|---|---|---|---|---|---|
| 1 | 11.81 GiB | 33.21 GiB | 8.48 GB | 352 % | 38.3 / 43.7 / 74.3 s |
| 2 | 11.83 GiB | 33.22 GiB | 8.51 GB | 248 % | 39.3 / 40.4 / 79.5 s |
| 3 | 11.83 GiB | 33.22 GiB | 8.68 GB | 323 % | 45.7 / 50.1 / 81.7 s |
| 4 | 11.83 GiB | 33.23 GiB | 8.49 GB | 347 % | 43.6 / 43.7 / 73.2 s |
| 5 | 11.83 GiB | 33.23 GiB | 8.72 GB | 265 % | 38.3 / 40.5 / 80.6 s |
| 6 | 11.78 GiB | 33.22 GiB | 8.80 GB | 305 % | 38.4 / 38.5 / 77.5 s |

- Range over 6 rounds: disk allocated **11.78-11.83 GiB** (logical 33.21-33.23 GiB), RAM **8.48-8.80 GB**, idle CPU **248-352 %**.
- Second baseline (stock `google_apis`, API 33, 2026-10-23): `baseline.json` / `baseline.md` — 24.74 GiB **logical** (not re-measured as allocated; the AVDs are gone), 8.45 GB, ~1000 %.
- crewdroid `up --count 3` (3 read-only clones, slimmed): 6.99 GiB allocated (slim.md), 3.93 GB, ~600 %.
