# Verified toolchain (T68)

Every `scripts/check-*.mjs` was last run on these builds. `setup` and `up` print one WARN line (not an error) when the installed emulator major.minor or a google_atd image revision differs. The values live in `src/compat.ts` (`VERIFIED`); `scripts/check-versions.mjs` fails when this file and that constant disagree.

| What | Verified |
|---|---|
| emulator | 37.1 (Pkg.Revision 37.1.11) |
| google_atd android-31 (x86_64) | revision 1 |
| google_atd android-34 (x86_64) | revision 1 |
| google_atd android-36 (x86_64) | revision 1 |

Read from `<sdk>/emulator/source.properties` and `<sdk>/system-images/android-N/google_atd/<abi>/source.properties` on 2026-10-27. After rerunning the checks on a new build, update both this table and `src/compat.ts`.
