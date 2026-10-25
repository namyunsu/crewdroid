# Runtime features: idle cost

One row per Todo that adds a runtime command (docs/todo.md lightness rule: no launch flag / AVD config / KNOBS change; idle RAM over +5 % -> opt-in). RAM = emulator+qemu working set, CPU = % of one host core over the idle window, probe app stopped.

| date | Todo | devices | idle s | RAM before -> after (MB) | RAM delta | CPU before -> after (%) | note |
|---|---|---|---|---|---|---|---|
| 2026-10-25 | T22 triage/screen/perf/apk | 1 (s24ultra API 34; T22 accept boots 1) | 30 | 1271 -> 1085 | -14.6 % | 8.1 -> 13.7 | no daemon; after = after crash/anr/jank/heap runs |
