# Daeri: a three-driver dispatch app

The app and server behind [`docs/measurements/daeri-trial.md`](../../docs/measurements/daeri-trial.md). Daeri is a Korean designated-driver service: one call shows on every driver's phone, and only one driver may take it.

| File | What it is |
|---|---|
| `server.mjs` | the API. `BUGGY=1` lets two drivers take one call and pays a retried fare twice |
| `app/` | the driver app, plain Android views |
| `flows/`, `scenario.json`, `rules.json` | three drivers take and finish calls while networks drop and 20 % of answers are lost |
| `spec.md`, `prompt.md` | what both agents were given in the side-by-side run |

```bash
probe-app/gradlew -p examples/daeri/app assembleDebug
BUGGY=1 node examples/daeri/server.mjs 5596
npx crewdroid run examples/daeri/scenario.json --seed 1 --lose-acks 0.2   # exit 1: dupSuccess, unique(tripKey)
```

Stop the server, start it again without `BUGGY=1` and `run` exits 0.

To repeat the agent run, copy `spec.md` into an empty Android project, start the buggy server on port 5597 and give an agent `prompt.md`. Change only the emulator tools between the two sides.
