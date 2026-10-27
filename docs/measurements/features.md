# Runtime features: idle cost

One row per Todo that adds a runtime command (docs/todo.md lightness rule: no launch flag / AVD config / KNOBS change; idle RAM over +5 % -> opt-in). RAM = emulator+qemu working set, CPU = % of one host core over the idle window, probe app stopped.

| date | Todo | devices | idle s | RAM before -> after (MB) | RAM delta | CPU before -> after (%) | note |
|---|---|---|---|---|---|---|---|
| 2026-10-25 | T20 env | 2 (s24ultra@34, flip7-main@36) | 30 | 2620 -> 1621 | -38.1 % | 64.1 -> 22.4 | no daemon; after = after every env command ran (geo/battery/rotate/dark/font/locale/gsm/sms/call) |
| 2026-10-25 | T21 app | 2 (s24ultra@34, flip7-main@36) | 30 | 2601 -> 1712 | -34.2 % | 142.6 -> 15.6 | no daemon; after = after every app command ran (perm/open/links/clear/backup/restore/pressure/fill-storage) |
| 2026-10-25 | T22 triage/screen/perf/apk | 3 (s24ultra@34, s22@31, flip7-main@36) | 30 | 3610 -> 2452 | -32.1 % | 73 -> 53.9 | no daemon; after = after crash/anr/jank/heap runs |
| 2026-10-27 | T52 agent helper | 3 (s24ultra@34, s22@31, flip7-main@36) | 30 | 2300 -> 2323 | +1 % | 46 -> 53.3 | daemon: on-device helper; before = helper stopped, after = mean of helper running before and after that window; helper PSS 34: 20 of 842 MB, 31: 14 of 710 MB, 36: 24 of 839 MB |
