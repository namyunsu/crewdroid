# Baseline: existing AVDs x3 (T01)

- Date: 2026-10-23 (UTC 08:09) · raw: `baseline.json`
- PC: AMD Ryzen 7 5700X 8-core/16 threads, 64 GB RAM, Windows 11 (10.0.26300), RTX 3080
- Emulator: 37.1.11.0 · image: android-33 google_apis x86_64
- Flags: `-no-window -no-audio -read-only -gpu host -camera-back emulated`, 3 s launch stagger, 60 s idle sampling after all booted

| AVD | Serial | Disk (AVD dir) | Disk (+ system image, counted once) | Boot | Host RAM | Host CPU (60 s idle avg) |
|---|---|---|---|---|---|---|
| old-avd-1 | emulator-5580 | 5.82 GiB | 13.99 GiB | 31.6 s | 2843 MB | 347 % |
| old-avd-2 | emulator-5582 | 5.50 GiB | 5.50 GiB | 27.4 s | 2813 MB | 335 % |
| old-avd-3 | emulator-5584 | 5.25 GiB | 5.25 GiB | 23.3 s | 2797 MB | 318 % |

- Total disk for 3: 5.82 + 5.50 + 5.25 + 8.17 (system image) = 24.74 GiB. Total RAM ~8.5 GB. CPU % is of one core (100 % = 1 core), about 10 cores for 3 devices.
- Finding: launching three emulators in the same instant hung one at startup intermittently (2 of 3 runs); a 3 s stagger fixed it (1 run, 1 pass).
