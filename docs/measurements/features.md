# Runtime features: idle cost

One row per Todo that adds a runtime command (docs/todo.md lightness rule: no launch flag / AVD config / KNOBS change; idle RAM over +5 % -> opt-in). RAM = emulator+qemu working set, CPU = % of one host core over the idle window, probe app stopped.

| date | Todo | devices | idle s | RAM before -> after (MB) | RAM delta | CPU before -> after (%) | note |
|---|---|---|---|---|---|---|---|
| 2026-10-25 | T22 triage/screen/perf/apk | 3 (s24ultra@34, s22@31, flip7-main@36) | 30 | 3657 -> 2781 | -24 % | 122.7 -> 44.5 | no daemon; after = after crash/anr/jank/heap runs |
| 2026-10-25 | T20 env | 2 (s24ultra@34, flip7-main@36) | 30 | 2726 -> 1626 | -40.4 % | 212.7 -> 26.8 | no daemon; after = after every env command ran (geo/battery/rotate/dark/font/locale/gsm/sms/call) |
| 2026-10-25 | T20 env | 2 (s24ultra@34, flip7-main@36) | 30 | 2620 -> 1621 | -38.1 % | 64.1 -> 22.4 | no daemon; after = after every env command ran (geo/battery/rotate/dark/font/locale/gsm/sms/call) |
