# Device spec: `--cores` / `--ram` (FR-41, T64)

`crewdroid up [--cores N] [--ram MB]` and the optional profile fields `cores` / `ramMB` set the guest CPU count (`-cores`, `hw.cpu.ncore`) and RAM (`-memory`, `hw.ramSize`). Unset = today's defaults (2 cores; 896 MB, API 31 768 MB; avd.ts `KNOBS`), with the same base AVD and launch args as before.

Limits, checked before the lock is taken or anything launches (exit 1 with the reason): RAM below the image default (the T16 minimum: API 34/36 need >= 896 MB with `-lowram`, API 31 runs at 768), above 8192 MB or above free host RAM; cores outside 1..host logical CPUs. `-lowram` stays on for every spec (unchanged launch flags), so the guest keeps `ro.config.low_ram` even at 2048 MB+.

## Does a quickboot snapshot saved with one `-memory`/`-cores` load with another?

No. Measured 2026-10-27 (emulator 37.1.11.0, Windows 11, WHPX): `-read-only` clones of `crew-android-36-google_atd` (snapshot `default_boot` saved with `hw.ramSize = 896`, `hw.cpu.ncore = 2`), launched with the usual args and `-verbose`, only `-memory`/`-cores` changed. Log lines:

| `-memory` / `-cores` | emulator log | boot to `sys.boot_completed` | guest nproc / MemTotal |
|---|---|---|---|
| 896 / 2 (as saved) | `Successfully loaded snapshot 'default_boot' using 941 ms` | 5.6 s | 2 / 839 MB |
| 2048 / 4 | `Failed to load snapshot 'default_boot'` / `The emulator is starting from scratch. Reason: different AVD configuration` | 24.5 s | 4 / 1972 MB |
| 896 / 4 | same failure (cores alone) | 28.6 s | 4 / 839 MB |
| 2048 / 2 | same failure (RAM alone) | 23.7 s | 2 / 1972 MB |

The guest gets the asked spec either way, but every changed RAM or core count cold-boots the clone. So a non-default spec gets its own base AVD `crew-<image>-r<ramMB>-c<cores>` (e.g. `crew-android-34-google_atd-r2048-c4`): `up` runs `prepare` for it on first use (cold boot, probe install, snapshot save, NTFS compression = the same slim steps as the default AVD) and its clones then load that snapshot. The default spec keeps the old AVD name, so nothing is re-prepared for users who do not ask for a spec. `crewdroid slim` re-prepares only the default base AVDs; a spec AVD made with old knobs is re-prepared by `up` on its next use (same `crewdroid-slim.json` check).

`a16-lowend` (profiles/galaxy.json) = a16's screen with `cores: 4`, `ramMB: 2048`. Both numbers are a guess, scaled down from the real Galaxy A16 5G (8 cores, 4 GB+) to keep the host cost low.

## Measured by scripts/check-spec.mjs

Date: 2026-10-27. Each run starts after `down`. Wall = whole `up` command incl. node start and, on a first use, `prepare` of the spec's base snapshot.

| Run | device | profile | API | AVD | cores / RAM asked | guest nproc / MemTotal | snapshot load | boot (s) | ready (s) | wall (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| up (default) | emulator-5580 | s24ultra | 36 | crew-android-36-google_atd | 2 / 896 MB | 2 / 839 MB | 40.514 s | 46.2 | 54.9 | 55.9 |
| up --cores 4 --ram 2048 (1st) | emulator-5580 | s24ultra | 36 | crew-android-36-google_atd-r2048-c4 | 4 / 2048 MB | 4 / 1972 MB | 1.678 s | 6.1 | 6.7 | 173.4 |
| up --cores 4 --ram 2048 (2nd) | emulator-5580 | s24ultra | 36 | crew-android-36-google_atd-r2048-c4 | 4 / 2048 MB | 4 / 1972 MB | 1.699 s | 6.1 | 6.7 | 7.8 |
| up --count 2 --profiles s24ultra,a16-lowend | emulator-5580 | s24ultra | 34 | crew-android-34-google_atd | 2 / 896 MB | 2 / 842 MB | 0.979 s | 5.6 | 32.7 | 134.1 |
| up --count 2 --profiles s24ultra,a16-lowend | emulator-5582 | a16-lowend | 34 | crew-android-34-google_atd-r2048-c4 | 4 / 2048 MB | 4 / 1974 MB | 1.765 s | 3.4 | 21.4 | 134.1 |

Rejected before launch:

- `up --ram 128`: exit 1 in 0.7 s: --ram 128: android-36/google_atd needs at least 896 MB (integer MB)
- `up --cores 999`: exit 1 in 0.7 s: --cores 999: must be 1..16 (host logical CPUs)

Disk cost of each spec base AVD (allocated, after `prepare` compressed it):

- crew-android-36-google_atd-r2048-c4: 1498 MiB
- crew-android-34-google_atd-r2048-c4: 1396 MiB
