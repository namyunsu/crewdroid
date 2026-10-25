# Screen size limits (T18, FR-14)

One device per row, fresh boot, `up` with a custom profile (density derived for ~360dp short side). RAM = emulator+qemu working set after the probe app drew one frame. `ok` = screencap PNG equals the requested size and is not >99 % one colour.

| API | size | density | window | boot s | ready s | RAM MB | screencap | ok | note |
|---|---|---|---|---|---|---|---|---|---|
| 34 | 3840x2160 | 960 | no | 22.2 | 53.8 | 1498 | 3840x2160 | yes |  |
| 34 | 5120x1440 | 640 | no | 22.1 | 52.8 | 1469 | 5120x1440 | yes |  |
| 34 | 7680x2160 | 960 | no | 22.2 | 53 | 1465 | 7680x2160 | yes |  |
| 36 | 3840x2160 | 960 | no | 23.3 | 55.8 | 1436 | 3840x2160 | yes |  |
| 36 | 5120x1440 | 640 | no | 23.2 | 56.9 | 1395 | 5120x1440 | yes |  |
| 36 | 7680x2160 | 960 | no | 24.3 | 59.4 | 1423 | 7680x2160 | yes |  |
| 34 | 3840x2160 | 960 | yes | 24.3 | 55.7 | 1618 | 3840x2160 | yes |  |

Findings: every size up to 7680x2160 booted and rendered on API 34 and 36 (largest tested; no failing size found). `wm size` only accepts up to 2x the physical display per side (base AVD 1080x2340 clamped 3840x2160 to 2160x2160), so a profile past that gets `-skin <W/2>x<H/2>` + `-no-snapshot-load` (cold boot; see `skinFor` in src/up.ts). Profiles within the limit keep the unchanged launch args and quickboot. Window mode shows a scaled window; screencap stays full resolution.
