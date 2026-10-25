---
name: android-offline-concurrency
description: Offline sync made duplicate records, lost an update, or dropped an upload; two users editing the same item overwrite each other; a retry after a network cut stored a row twice. Reproduces it with an offline outbox, airplane / no-data / slow / flaky network per emulator, several devices with their own timing, then judges the server data for duplicate, missing and lost-update rows.
license: MIT
---
<!-- Commands fenced as `bash verify` are run on a crew device (API 34) by scripts/check-skills.mjs with $SERIAL/$PKG/$SERVER_PORT substituted
     and a clean sample server listening on $SERVER_PORT. Requirements: docs/prd.md FR-09 (offline) and FR-10 (multi-user field run). -->
# android-offline-concurrency: duplicates, lost updates, offline sync

Placeholders: `$SERIAL` = `emulator-<port>` (never a USB phone serial), `$PKG` = the app package, `$SERVER_PORT` = host port of your API.
From a device the host is `10.0.2.2`. In a checkout without the package installed, `crewdroid` = `npx tsx src/cli.ts`.
The example app is crewdroid's sample (an outbox of photos/edits driven by adb broadcasts); swap in your app's own actions.

Start the sample server first (from a crewdroid checkout; `BUGGY=1` = no idempotency dedupe and no version check):
```bash
npx tsx sample/server/main.ts $SERVER_PORT            # clean;  BUGGY=1 npx tsx sample/server/main.ts $SERVER_PORT  for the buggy one
```

## A. One device: save offline, sync when back (FR-09)

1. Open the app (its outbox thread runs while the process lives) and go offline.
```bash verify
adb -s $SERIAL logcat -c
adb -s $SERIAL shell am start -W -n $PKG/.ProbeActivity | grep 'Status: ok'
crewdroid net $SERIAL airplane
```
   `net` states: `airplane` (all radios off), `nodata` (wifi + mobile data off), `slow` (~1 Mbit/s + 300 ms), `flaky` (seeded on/off
   loop, `--seed N`), `online` (back to normal; also stops a flaky loop).

2. Do the user action while offline: here a photo and two edits of the same record from one stale read.
```bash verify
B="adb -s $SERIAL shell am broadcast --include-stopped-packages -n $PKG/.SampleReceiver -a dev.crewdroid.sample"
S="--es server http://10.0.2.2:$SERVER_PORT"
$B.PHOTO --es id p1 $S | grep 'Broadcast completed'
$B.EDIT --es id rec1 --es value a $S | grep 'Broadcast completed'
$B.EDIT --es id rec1 --es value b $S | grep 'Broadcast completed'
sleep 2
adb -s $SERIAL shell ls -1 /data/data/$PKG/files/outbox | grep -c '\.json$'
```
   The count (here 3; `ls -1`, plain `ls` may print several names per line) = entries waiting in the outbox; they are files, so they survive a force-stop or an offline restart.

3. Back online; wait for the outbox to drain.
```bash verify
crewdroid net $SERIAL online
B="adb -s $SERIAL shell am broadcast --include-stopped-packages -n $PKG/.SampleReceiver -a dev.crewdroid.sample"
$B.SYNC > /dev/null
for i in $(seq 45); do adb -s $SERIAL logcat -d -s CrewProbe:I | grep -q 'CONFLICT rec1' && break; sleep 2; done
adb -s $SERIAL logcat -d -s CrewProbe:I | grep -E 'SAVED|RETRY|SYNCED|CONFLICT|DROPPED'
adb -s $SERIAL logcat -d -s CrewProbe:I | grep -q 'SYNCED p1'
```
   App log lines and what they mean:
   - `SAVED <id> <key>`: queued with an idempotency key fixed at save time.
   - `RETRY <id> attempt=<n> <reason>`: send failed (offline, cut, 5xx); the same key is resent later.
   - `SYNCED <id> <key> http=200`: the server stored it.
   - `CONFLICT <id> base=<v> server=<v>`: the server refused a write based on an old version (correct: no silent overwrite).
     Here the second edit of `rec1` was based on version 0 like the first one, so a correct server answers 409.
   - `DROPPED <id> http=4xx`: permanent rejection; the data is gone from the outbox.

4. Judge the server data. Rules: `unique(f)` = no two rows share `f` (duplicates); `count(src)` + `on` = every `on` value in `src`
   (the server's ack log) has a row (missing); `noLostUpdate(id,ver)` = no two accepted writes share one base version (lost update).
```bash verify
cat > rules.json <<'EOF'
{ "rules": [
  { "table": "uploads", "rule": "unique(key)" },
  { "table": "uploads", "rule": "count(acks)", "on": "key" },
  { "table": "writes", "rule": "noLostUpdate(id,baseVersion)" } ] }
EOF
crewdroid judge --rules rules.json --source http://127.0.0.1:$SERVER_PORT | tee judge.txt
grep '^OK: 3 rules, 0 violations' judge.txt
```
   `--source` = a URL returning `{table: rows[]}` JSON (the sample's `/export`) or a `.json` file. Exit 1 on any violation.

## B. Many devices, mixed network, own timing (FR-10)

5. Field run: boots N mixed Galaxy devices, each repeats photo -> read -> edit with seeded pauses while its own network walks
   airplane / nodata / slow / flaky (different order per device), drains, judges, downs. No shared "press at the same moment" start.
```bash
crewdroid run scenarios/photo-upload.json --seed 1 --server-port $SERVER_PORT --count 3
```
   Per device: `<serial> <profile> API <n> net: <t>s <state>, ... | SAVED=.. SYNCED=.. RETRY=.. CONFLICT=.. DROPPED=..`, then
   `VIOLATION ...` lines and `OK|FAIL: drained=<bool> (<s>s) violations=<n> wall=<s>s ... seed=<n>`.
   `drained=false` = some outbox never emptied (stuck retry loop: read its `RETRY` reasons). Same `--seed` = same pauses and network
   order, so a failure can be re-run. Expect `FAIL` with `BUGGY=1` and `OK` with the clean server.

6. Read a violation (`crewdroid judge ... --json` -> `violations[].rows` are the offending rows):
   - `VIOLATION uploads unique(key): duplicate key="..." (2 rows)`: a retry after a lost response was stored again. Fix: dedupe on the
     client's idempotency key on the server.
   - `VIOLATION uploads count(acks): missing N of M expected key values`: the server said 200 but the row is not there (racy write).
   - `VIOLATION writes noLostUpdate(id,baseVersion): lost update: 2 writes to id="r1" all based on baseVersion=3`: two clients edited
     the same version and both were accepted; one change silently vanished. Fix: compare-and-set on the version, return 409.
   Then re-run the same seed against the fixed server; `OK` = fixed for that timing, try 2-3 more seeds.

7. Load without emulators (API only, N virtual users with jitter and retries): `crewdroid hammer --url http://127.0.0.1:$SERVER_PORT
   --users 10 --repeat 5 --rules rules.json`.

## What this cannot tell you
Bugs in timings the seeds did not hit (it samples, it does not prove), server bugs that need real cellular handover or real latency
distributions, or which code line caused a violation (it shows the rows; correlate their keys/clients with the app log).
