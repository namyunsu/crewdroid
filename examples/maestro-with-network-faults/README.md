# maestro-with-network-faults

Maestro drives the app. crewdroid makes the condition (one device loses its network mid-flow) and judges the server data afterwards.

Files:
- `flow.yaml`: a Maestro flow for the bundled Field Notes demo app: add a note, save it.
- `run.mjs`: boots 2 devices, runs the flow on both with `maestro --device`, switches the first device to airplane mode while its flow runs, switches it back, then runs `judge`.
- `rules.json`: `unique(id)` on `records`, `noLostUpdate(id,baseVersion)` on `writes`.

## Run

You need [Maestro](https://maestro.mobile.dev) on your PATH, and an Android SDK (`npx crewdroid setup --yes` installs one).

```bash
./probe-app/gradlew -p demo-app assembleDebug       # builds demo-app/build/outputs/apk/debug/crewdroid-demo-debug.apk
npx tsx examples/maestro-with-network-faults/run.mjs
```

The script starts the sample server on `:5599` itself and stops the emulators at the end (`crewdroid down`).

What happens, in order:
1. `crewdroid up --count 2` and `crewdroid install all <apk>`.
2. `maestro test --device emulator-5580 flow.yaml` and `maestro test --device emulator-5582 flow.yaml` start together.
3. After 6 s: `crewdroid net emulator-5580 airplane`. That device has no network until step 4. The app keeps the note and retries `PUT /records/:id` until the server answers.
4. When the `net` call returns: `crewdroid net emulator-5580 online`. The retry goes through.
5. `crewdroid judge --rules rules.json --source http://127.0.0.1:5599/export`. Exit code 0 means each note arrived once and nothing was overwritten.

Maestro needs a few seconds to start, so the 6 s cut can land before the first tap. Raise the first `sleep` in `run.mjs` to cut later in the flow.

Real output of one run (exit code 0; 2 devices, API 34 and API 31; the `[ N s]` stamps count from the moment Maestro starts; the Maestro lines of the two devices interleave):

```
[  6 s] net airplane on emulator-5580
Running on crew-android-34-google_atd
 > Flow flow
Launch app "dev.crewdroid.demo" with clear state... COMPLETED
Tap on "New note"... COMPLETED
Input text Fix pump #3... COMPLETED
Tap on "Save"... COMPLETED
Assert that "Fix pump #3" is visible... COMPLETED
[ 36 s] maestro emulator-5582 finished, exit 0
[ 46 s] net online on emulator-5580
[ 97 s] maestro emulator-5580 finished, exit 0
maestro exit codes: emulator-5580=0 emulator-5582=0
[107 s] server holds 2 records, 2 writes
{
  "ok": true,
  "rules": 2,
  "violations": []
}
```

To see the judge fail, start the sample server with the bug switched on (`BUGGY=1 npx tsx sample/server/main.ts 5599`) and run steps 2 to 5 by hand.
