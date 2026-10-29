# judge-your-api

Check any backend's data for duplicate, missing and overwritten records. No emulator, no app: `judge` reads a JSON export and a rules file.

Files:
- `rules.json`: three rules (`unique`, `count`, `noLostUpdate`).
- `export-buggy.json`: an export with one duplicate order, one missing order and one lost update.
- `export-clean.json`: the same data without those bugs.

## Run

```bash
npx crewdroid judge --rules examples/judge-your-api/rules.json --source examples/judge-your-api/export-buggy.json
```

Real output, exit code 1:

```
VIOLATION orders unique(requestId): duplicate requestId="r2" (2 rows)
  {"requestId":"r2","total":30}
  {"requestId":"r2","total":30}
VIOLATION orders count(requests): missing 1 of 4 expected requestId values (table has 4 rows)
  {"requestId":"r3"}
VIOLATION profiles noLostUpdate(id,baseVersion): lost update: 2 writes to id="u1" all based on baseVersion=3; all but one were overwritten
  {"id":"u1","baseVersion":3,"name":"Kim"}
  {"id":"u1","baseVersion":3,"name":"Kim Jr"}
FAIL: 3 violations
```

```bash
npx crewdroid judge --rules examples/judge-your-api/rules.json --source examples/judge-your-api/export-clean.json
```

Real output, exit code 0:

```
OK: 3 rules, 0 violations
```

## Use it on your API

1. Make your backend return its tables as JSON: `{ "orders": [ {...}, ... ], "profiles": [ ... ] }`. A file works, and so does a URL (`--source http://localhost:3000/export`).
2. Edit `rules.json`:
   - `unique(field)`: no two rows of the table share `field`.
   - `count(src)` with `"on": field`: every row of `src` (a table in the same export, a `.json` file or a URL) has a row in this table with the same `field`.
   - `noLostUpdate(id,version)`: no two accepted writes to the same `id` were based on the same `version`.
3. Run your flow (by hand, with Maestro, with `crewdroid run`), then run `judge`. Exit code 1 means a rule failed.
