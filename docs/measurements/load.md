# Used-phone load (`load off|low|mid|high`, T62, FR-42)

A real user's phone has many installed apps, several of them alive in the background, little free RAM and some CPU work
going on. `crewdroid load <serial> <level>` (or `up --load <level>`, MCP tool `load`) puts one emulator into that state;
`off` takes it all away again. Off by default: a plain `up` installs and starts nothing of this.

## Recipes (fixed, `RECIPES` in src/load.ts)

| level | installed filler apps | background processes | MemAvailable left (of the off-level value) | CPU workers | alarms | jobs |
|---|---|---|---|---|---|---|
| off | 0 (uninstalled; `--keep-apps` keeps them) | 0 | 100 % | 0 | 0 | 0 |
| low | 30 | 5 | 50 % | 10 % duty on every guest core | 10 | 3 |
| mid | 80 | 15 | 30 % | 25 % | 30 | 8 |
| high | 150 | 30 | 15 % | 50 % | 60 | 15 |

- Filler apps: `dev.crewdroid.filler.f001..f150`, tiny APKs made once by `scripts/gen-filler-apks.mjs` (aapt2 + d8, no
  Gradle; cached in `load-app/build/fillers/`). Every 3rd one has code: a receiver for `BOOT_COMPLETED`,
  `CONNECTIVITY_CHANGE` and `dev.crewdroid.filler.WAKE` that schedules a 15-minute periodic job. After install, `load`
  sends each of them one explicit WAKE broadcast (packages start in the stopped state), so they schedule their job as
  they would after a boot. Note: Android 7+ no longer delivers `CONNECTIVITY_CHANGE` to manifest receivers; it is
  declared because real apps still declare it.
- Background processes: services `Procs$P1..P30` of the load app `dev.crewdroid.load` (`load-app/`), one process each
  (`:p1`..`:p30`), each holding 4 MB of heap, `START_STICKY` (restarted after a low-memory kill, as apps are).
- Memory ballast: the load app's foreground service maps shared memory in 8 MB chunks filled with pseudo-random words
  (zram cannot compress it) until MemAvailable is at the level's share of the value measured with load off, and keeps
  topping up while it runs (kswapd moves other apps' pages to zram, which gives some RAM back).
- CPU: one thread per guest core, busy `cpu` ms of every 100 ms. Alarms: inexact repeating `ELAPSED_REALTIME_WAKEUP`
  (Android clamps the interval to 60 s). Jobs: one-off JobScheduler jobs that do ~2 M multiply-adds and reschedule
  themselves 10-30 s later.
- `off` = `am force-stop dev.crewdroid.load` (kills its processes, alarms, jobs and the ballast), then uninstall of the
  fillers and the load app unless `--keep-apps`.

The reported state (`--json` `guest`): MemTotal / MemAvailable (MB and %), swap used, load average, CPU busy % over 3 s,
running processes (and how many are the load app's), installed packages (and how many are fillers).

## Which guest

The default `up` guest (896 MB, `-lowram`) has little to take: right after boot MemAvailable was 134 MB (15.5 % of
862 MB) with 400 MB already in zram (API 34, measured by hand 2026-10-27). There `low` (50 % of that = 64 MB) already
sits at lmkd's foreground kill line (`sys.lmk.minfree_levels` 18432 pages = 72 MB for adj 0), so mid/high cannot be
told apart. The measurements below therefore use `--cores 4 --ram 2048` (the `a16-lowend` spec of T64). `load` works
on any guest; on the default one expect lmkd kills from `low` on (3 default guests, 2026-10-27: `low` left MemAvailable
at 6.5 / 5.1 / 1.4 % on API 31 / 34 / 36, docs/measurements/features.md).

## Reading the numbers (2026-10-27 runs below)

- Free RAM falls level by level on both APIs. It lands a little above the 50 / 30 / 15 % targets (e.g. API 34: 479 / 286 / 142 MB
  against about 475 / 285 / 143 MB = the shares of the 952 MB baseline) because kswapd keeps giving RAM back to the
  ballast's top-ups by moving other pages to zram.
- CPU busy matches the duty cycle (10 / 25 / 50 % of 4 cores -> 9.3-9.6 / 24.9-27.8 / 49.7-52 %).
- Cold start: the probe is slower under load in the latest run, but not strictly level by level (API 34 391 / 417 / 485 / 442 ms, API 36 420 / 469 / 467 / 1105 ms). The first
  run the same day had API 34 low 415 ms vs mid 413 ms: a single run varies by 100-600 ms (first launch after a level
  change is the slowest), so the steps between low and mid fall inside the noise; high is the slowest on API 36 only.
- Jank % does not change with the level: ATD renders without a GPU, so 66-100 % of the probe's few frames count as
  janky even with no load (see `perf`). Compare it between runs only.
- No LOW_MEMORY kill of the probe at any level on the 2048 MB guest: at `high` 120-160 MB are still free, so lmkd
  kills nothing in the probe's 5 s in the background. On the default 896 MB guest that changes (see above).
- Host cost: CPU goes from ~0.2 host cores idle to ~0.55 / 1.1-1.3 / 2.1 host cores at low / mid / high. The emulator's
  Windows working set did not grow (2.4 GB idle, 1.7-2.3 GB under load); [why: not measured; guest RAM is mapped
  at boot, and Windows trims the working set under pressure].
- `off` leaves no load process and no filler. MemAvailable can end above the baseline (first run API 36: 1065 vs 858 MB),
  because pages that kswapd moved to zram under the ballast stay there until used; `check-load` therefore only fails
  when `off` ends more than 10 % below the baseline.

## Measured by scripts/check-load.mjs

Date: 2026-10-27. One device per API (`up --api N --cores 4 --ram 2048`, s24ultra screen), probe app installed, 60 s idle, then baseline -> low -> mid -> high -> off on the same device. MemAvailable / CPU busy = guest /proc/meminfo, /proc/stat over 10 s. Cold start = `perf` TotalTime (force-stop, 2 s, `am start -W`), 5 runs, median; jank = median of the 5 runs' gfxinfo janky %. Kills = new LOW_MEMORY exit-info records of the probe (it goes to the background for 5 s after each run). Host = emulator+qemu working set and CPU (% of one host core) over the same 10 s.

| API | level | apply (s) | MemAvailable MB (% of total) | swap used MB | CPU busy % | load avg 1m | processes (load app) | packages (fillers) | cold start ms median (runs) | jank % | probe LOW_MEMORY kills | host RAM MB | host CPU % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 34 | baseline (no load) | - | 963 (48.8 %) | 71 | 0.3 | 2.04 | 314 (0) | 145 (0) | 391 (442, 351, 387, 412, 391) | 100 | 0 | 2496 | 9.6 |
| 34 | low | 34.7 s | 479 (24.3 %) | 87 | 9.3 | 0.81 | 330 (6) | 176 (30) | 417 (512, 446, 370, 398, 417) | 100 | 0 | 1968 | 53.9 |
| 34 | mid | 35.1 s | 286 (14.5 %) | 127 | 24.7 | 1.42 | 347 (16) | 226 (80) | 485 (443, 550, 468, 485, 771) | 66.67 | 0 | 1684 | 109.3 |
| 34 | high | 38.1 s | 142 (7.2 %) | 143 | 49.6 | 1.97 | 384 (31) | 296 (150) | 442 (592, 526, 404, 425, 442) | 66.67 | 0 | 1782 | 203.7 |
| 34 | off | 33.3 s | 1056 (53.5 %) | 337 | 22.4 | 4.54 | 314 (0) | 145 (0) | - | - | - | - | - |
| 36 | baseline (no load) | - | 876 (44.4 %) | 134 | 0.4 | 4.53 | 420 (0) | 140 (0) | 420 (731, 420, 428, 408, 409) | 66.67 | 0 | 2415 | 14 |
| 36 | low | 37.1 s | 401 (20.3 %) | 148 | 9.6 | 1.25 | 439 (6) | 171 (30) | 469 (482, 469, 432, 436, 526) | 66.67 | 0 | 2094 | 56.3 |
| 36 | mid | 36.2 s | 235 (11.9 %) | 249 | 29.1 | 2.73 | 401 (16) | 221 (80) | 467 (566, 449, 481, 467, 431) | 66.67 | 0 | 1987 | 133 |
| 36 | high | 49.5 s | 119 (6 %) | 988 | 49.2 | 3.54 | 463 (31) | 291 (150) | 1105 (1912, 1016, 1105, 820, 1127) | 100 | 0 | 2063 | 204 |
| 36 | off | 32.6 s | 1011 (51.3 %) | 298 | 0.7 | 9.53 | 400 (0) | 140 (0) | - | - | - | - | - |

`up --api 36 --cores 4 --ram 2048 --load mid`: whole command 57 s (device ready 7.2 s, then load 48.8 s); after it MemAvailable 12.4 %, 16 load processes, 80 fillers.

`off` against the baseline (MemAvailable can end above it: idle pages that kswapd moved to zram under the ballast stay there until used):

- API 34: off 1056 MB vs baseline 963 MB (+9.6 %), swap used 71 -> 337 MB
- API 36: off 1011 MB vs baseline 876 MB (+15.4 %), swap used 134 -> 298 MB

Not as expected (reported, not failed):

- API 34: cold start median high 442 ms not above mid 485 ms
- API 36: cold start median mid 467 ms not above low 469 ms
