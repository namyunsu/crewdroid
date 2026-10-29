# Your app in 10 minutes: `crewdroid run` on any APK

`run` boots N mixed emulators (Galaxy screens x Android 31/34/36), installs your APK, lets every device repeat your own steps at its own seeded pace (no "press at the same moment" barrier, ADR 0002) while its network drops in and out, waits until the devices stop talking to the server, then judges what reached the server. It needs no change to your app: a release build works (no `adb root` into the app, no `run-as`, no test receiver).

## 1. What you need
- crewdroid set up (`npx crewdroid setup`), Maestro on PATH (`scoop install maestro`, `brew install maestro`, or https://maestro.dev) if your steps are Maestro flows.
- Your APK and your backend running on the host over plain HTTP (HTTPS is tunnelled blind; see `docs/adr/0008-proxy-judge.md`).
- Your app must reach the backend through the Android system proxy (OkHttp / HttpURLConnection do; Flutter's `dart:io`, Cronet/QUIC and raw sockets do not) and be allowed to send cleartext HTTP (`usesCleartextTraffic` or a network security config). Check with `crewdroid apk your.apk`.

## 2. Write the scenario (one JSON file)
```json
{
  "name": "my-app",
  "app": { "apk": "build/app-release.apk", "package": "com.example.app" },
  "devices": { "count": 3 },
  "repeat": 5,
  "delayMs": [1000, 4000],
  "network": { "states": ["airplane", "nodata", "slow", "flaky"], "badMs": [5000, 12000], "onlineMs": [3000, 8000] },
  "server": { "target": "http://127.0.0.1:8080" },
  "setup": [{ "maestro": "flows/login.yaml", "env": { "URL": "http://10.0.2.2:8080" } }],
  "actions": [
    { "maestro": "flows/create-item.yaml", "env": { "TITLE": "{serial} item {iter}" } },
    { "intent": { "action": "android.intent.action.VIEW", "data": "myapp://sync" } },
    { "adb": ["shell", "cmd", "jobscheduler", "run", "-f", "com.example.app", "1"] }
  ],
  "drain": { "idleSeconds": 20, "timeoutSeconds": 180 }
}
```
Paths are relative to the scenario file. Unknown fields, an unknown action or a missing file stop `run` with exit 1 before any emulator boots.

| Field | Meaning |
|---|---|
| `app.apk`, `app.package` | installed with `adb install -r -g` on every device (permissions granted) |
| `devices` | `count` (default 3; `--count` overrides), `profiles` (names from `profiles/galaxy.json`), `api` (31, 34, 36 or `"latest"`; unset = mixed) |
| `repeat`, `delayMs` | every device runs `actions` `repeat` times, with its own seeded pause `[lo, hi]` ms after each action (`--seed` changes all of them) |
| `network` | optional. Each device walks every state once in its own order, online gaps in between (`crewdroid net` states) |
| `setup` | optional, once per device before the loop (log in, point the app at the server). A failure stops the run |
| `actions` | per iteration, in order. `{maestro: "flow.yaml", env?}` = `maestro test --device <serial>`; `{intent: {action?, component?, data?, type?, extras?}}` = `am start -W`; `{adb: [...]}` = any adb command on that device only. A failed action is counted per device and makes the run's `ok` false |
| `drain` | when a device is done: `{idleSeconds}` (default 20: no request from that device through the proxy for N s), `{logPattern}` (a logcat line matching the regex, cleared when the drain starts) or `{waitText}` (text on screen); each with `timeoutSeconds` (default 180) |
| `server.target` | your backend as the host sees it. `run` starts the recording proxy (T69) in front of it and points every device's system proxy at it; the app keeps using `http://10.0.2.2:<port>` |
| `rules`, `source` | judge rules (default `judge/proxy.rules.json` on the proxy log). Table rules (`unique`, `count`, `noLostUpdate`) also need `source` = your `/export` URL or a JSON file |

Placeholders in `env` values, intent fields and adb arguments: `{serial}` (`emulator-5580`), `{device}` (0, 1, 2 ...), `{iter}` (0-based; -1 in `setup`). Maestro flows also get `CREW_SERIAL`, `CREW_DEVICE`, `CREW_ITER`.

## 3. Run and read the verdict
```bash
npx crewdroid run my-app.json --seed 1 --out report.json   # exit 0 = clean, 1 = violation / failed action / not drained
npx crewdroid run my-app.json --seed 1 --proxy 5590 --log proxy.jsonl --lose-acks 0.1   # keep the log; drop 10 % of write answers
```
`report.json`: per device the profile / API / screen, its network timeline, `log.actionsOk`, `log.actionsFailed`, `log.requests` (requests the proxy saw), the first errors, and `judge.violations`. Proxy rules: `dupSuccess` (one write applied twice), `lostUpdate(<path pattern>, <JSON pointer | header>)` (two edits on the same version both accepted), `lostWrite(N)` (a failed write not sent again within N s), `idle(N)`. Copy `judge/proxy.rules.json` and set the `lostUpdate` pattern to your API (`/items/:id`, version from the body `/version` or a header such as `if-match`).

`requests` = 0 on a device means the app never reached the proxy: check cleartext, the system proxy (see 1.) and the server URL in your setup flow.

## 4. Worked example: DAVx5 + Radicale (not our app)
`scenarios/davx5-contacts.json` runs DAVx5 4.5.21-ose, the F-Droid release APK of the open-source CalDAV/CardDAV sync app, against a local [Radicale](https://radicale.org) server. `node scripts/check-run-app.mjs` does all of it: downloads the APK to `.cache/` (sha256 pinned), puts Radicale in a venv under the temp folder, creates one shared address book, runs the scenario on 3 devices (s24ultra / API 34, fold5-main / API 34, s26ultra / API 36) and reads the server's files as a second opinion.

- `setup`: an intent opens DAVx5, `flows/davx5/login.yaml` pages through the intro, logs in to `http://10.0.2.2:5597/` (through the proxy) and turns on sync for the address book.
- `actions` x 4 per device: `adb shell content insert` adds a contact `<serial> c<iter>` to the DAVx5 address book (what a contacts app would do), an intent brings DAVx5 to the front, `flows/davx5/sync.yaml` presses "Sync all accounts".
- every device walks airplane / nodata / slow / flaky in its own order; drain = 45 s without a request (DAVx5 syncs local changes with a delay of about that); rules `judge/carddav.rules.json` (`lostUpdate` keyed on the `if-match` header).

Result (2026-10-28, seed 1, raw reports in `docs/measurements/run-app.json`): **the run found no bug in DAVx5.**

| Run | Devices (actions ok / failed / requests seen) | Verdict | Server kept | Wall |
|---|---|---|---|---|
| network faults | s24ultra/34: 12/0/38 · fold5-main/34: 12/0/36 · s26ultra/36: 12/0/32 | 0 violations, exit 0 | 12 of 12 contacts, none missing, none twice | 442 s |
| faults + `--lose-acks 0.3` | s24ultra/34: 12/0/41 · fold5-main/34: 12/0/38 · s26ultra/36: 12/0/37 | 0 violations, exit 0 | 12 of 12, none missing, none twice | 436 s |

With lost answers, 2 of 12 contact uploads (`PUT`) were committed by Radicale but their answer was cut; each time DAVx5 sent the same `PUT` again at once with `If-None-Match: *`, got `412` and did not create a second copy, so `lostWrite` and `dupSuccess` stay silent and the server's files agree. Uploads made while a device was offline went out after it came back (all 12 stored). What this run does not cover: concurrent edits of one shared contact (`lostUpdate`), and API 31.

### Why DAVx5 and not the planned Tasks.org
- Tasks.org (F-Droid 15.12) targets SDK 36 and its manifest has neither `usesCleartextTraffic` nor a network security config, so Android refuses plain HTTP to a local CalDAV server; over HTTPS the proxy only sees a blind tunnel and `--tls` is out of scope. Static reading of the manifest (`aapt2 dump xmltree`), not tried on a device.
- Gotify (cleartext allowed) needs its server binary run on the host; that was not allowed in this session.
- DAVx5 allows cleartext (`base-config cleartextTrafficPermitted="true"`), uses OkHttp (honours the system proxy), and Radicale installs with pip. The contacts provider is on the ATD images, so no extra app is needed.

### What the example taught (applies to your flows too)
- Maestro's `launchApp` dropped the adb connection ("device offline") on every try on the API 36 ATD clone; open the app with an `intent` action and start the flow without `launchApp`.
- On the API 31 clone (896 MB) the Maestro driver died mid-flow ("device server died", adb "device not found"), the low-memory limit in `docs/adr/0007-agent-helper.md`; the example's profiles avoid API 31.
- One Maestro invocation costs about 30-35 s on these clones (JVM start + driver handshake), so prefer a few longer flows over many short ones, and use `adb` actions for data the app reads from a provider.
- The server-side second opinion caught a bug in the example itself (T55 attempt 2, `--lose-acks` run): the adb action took "the newest raw contact" as the one it had just inserted, but DAVx5 had just synced down another device's contact, so the name landed on that contact (an `If-Match` PUT renamed `emulator-5584 c2`) and 11 of 12 names were left on the server. The proxy rules stayed silent, correctly: one edit per version is not a lost update. The action now picks the newest raw contact without a name. Watch for the same race when your adb steps read back what they wrote.
- WebDAV clients send `PROPFIND` / `REPORT` before every sync; the judge counts them as reads (before T55 they showed up as false `dupSuccess`).
