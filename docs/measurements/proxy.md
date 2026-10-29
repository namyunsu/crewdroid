# Proxy judge (T69)

`node scripts/check-proxy.mjs`. Raw data: `proxy.json`. Measured 2026-10-28.

## Overhead per request

Same host client, 400 sequential `POST /upload` (1024 B body) to the sample server, direct and through the proxy, alternating.
The proxy buffers the request and the response (it needs both hashes) and appends one JSONL line per request.

| path | p50 ms | p95 ms |
|---|---|---|
| direct | 0.65 | 0.81 |
| through proxy | 1.02 | 1.26 |
| overhead | +0.37 | +0.45 |

## CLI on one device (system proxy, unmodified probe app)

- `proxy start` -> `settings get global http_proxy` = `10.0.2.2:5590`
- logged under the serial: `GET /export 200`, `POST /upload 200`
- `proxy stop` -> `:0`; next READ goes direct: true
- new clone after `down` -> `null`

## Scenario through the proxy

`crewdroid run scenarios/photo-upload.json --seed N --proxy 5590 --lose-acks 0.1` (3 mixed devices, the app is not told about the proxy), then
`crewdroid judge --rules judge/proxy.rules.json --log proxy.jsonl`. `--lose-acks 0.1`: one write in ten gets its answer dropped after the server
committed it (the phone sees a reset and retries) — natural runs rarely hit that window (scenario.md: no duplicate in 6 BUGGY runs).

| server | seed | drained | judge exit | dupSuccess / lostUpdate / lostWrite / idle | /export judge (same run) | devices | app requests | OS pass-through | ms p50 / p95 (request start to server answer, incl. body upload) | wall s |
|---|---|---|---|---|---|---|---|---|---|---|
| BUGGY=1 | 1 | true | 1 | 3 / 6 / 0 / 0 | unique(key), noLostUpdate(id,baseVersion) | 3 | 65 (51 writes, 3 cut, 0 no answer) | 140 | 40 / 2148 | 197 |
| clean | 1 | true | 0 | 0 / 0 / 0 / 0 | - | 3 | 66 (51 writes, 3 cut, 0 no answer) | 142 | 1 / 2113 | 189 |
| BUGGY=1 | 2 | true | 1 | 2 / 6 / 0 / 0 | unique(key), count(acks), noLostUpdate(id,baseVersion) | 3 | 67 (50 writes, 2 cut, 0 no answer) | 125 | 41 / 2144 | 184 |
| clean | 2 | true | 0 | 0 / 0 / 0 / 0 | - | 3 | 68 (52 writes, 2 cut, 0 no answer) | 146 | 1 / 2113 | 187 |
| BUGGY=1 | 3 | true | 1 | 3 / 8 / 0 / 0 | unique(key), noLostUpdate(id,baseVersion) | 3 | 67 (51 writes, 3 cut, 0 no answer) | 131 | 42 / 1902 | 206 |
| clean | 3 | true | 0 | 0 / 0 / 0 / 0 | - | 3 | 68 (51 writes, 3 cut, 0 no answer) | 128 | 1 / 2111 | 194 |

All checks passed.
