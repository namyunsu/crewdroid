# 다자 현장 시나리오 (T10)

`node scripts/check-scenario.mjs` — `crewdroid run scenarios/photo-upload.json --seed N` 를 BUGGY / 정상 서버에 seed 1..3 씩. 원본: `scenario.json`.
기기마다 자기 지연으로 사진·읽기·수정을 8회 반복하고, 네트워크 상태 순서는 기기마다 다르다 (사이사이 online). 동시 누르기 배리어 없음.

| 서버 | seed | exit | outbox 비움 | 위반 (규칙) | 기기 / 네트워크 순서 | 기기별 SYNCED/RETRY/CONFLICT | 전체 s | 호스트 peak CPU / RAM |
|---|---|---|---|---|---|---|---|---|
| BUGGY=1 | 1 | 1 | true (0s) | 3 (noLostUpdate(id,baseVersion)) | s22/API31: airplane>nodata>slow>flaky<br>s24ultra/API34: nodata>slow>flaky>airplane<br>s26ultra/API36: slow>flaky>airplane>nodata | 16/4/0 · 16/0/0 · 16/7/0 | 213 | 58% / 23601 MB |
| clean | 1 | 0 | true (0s) | 0 (-) | s22/API31: airplane>nodata>slow>flaky<br>s24ultra/API34: nodata>slow>flaky>airplane<br>s26ultra/API36: slow>flaky>airplane>nodata | 11/7/5 · 14/9/2 · 13/5/3 | 205 | 54% / 23249 MB |
| BUGGY=1 | 2 | 1 | true (0s) | 5 (noLostUpdate(id,baseVersion)) | s22/API31: airplane>nodata>slow>flaky<br>s24ultra/API34: nodata>slow>flaky>airplane<br>s26ultra/API36: slow>flaky>airplane>nodata | 16/6/0 · 16/10/0 · 16/9/0 | 209 | 60% / 23228 MB |
| clean | 2 | 0 | true (0s) | 0 (-) | s22/API31: airplane>nodata>slow>flaky<br>s24ultra/API34: nodata>slow>flaky>airplane<br>s26ultra/API36: slow>flaky>airplane>nodata | 9/9/7 · 15/6/1 · 14/7/2 | 196 | 54% / 23250 MB |
| BUGGY=1 | 3 | 1 | true (0s) | 7 (count(acks), noLostUpdate(id,baseVersion)) | s22/API31: airplane>nodata>slow>flaky<br>s24ultra/API34: nodata>slow>flaky>airplane<br>s26ultra/API36: slow>flaky>airplane>nodata | 16/11/0 · 16/6/0 · 16/12/0 | 202 | 58% / 23132 MB |
| clean | 3 | 0 | true (0s) | 0 (-) | s22/API31: airplane>nodata>slow>flaky<br>s24ultra/API34: nodata>slow>flaky>airplane<br>s26ultra/API36: slow>flaky>airplane>nodata | 13/7/3 · 11/8/5 · 14/4/2 | 208 | 56% / 23292 MB |

결과: BUGGY 위반 발견 3/3 (기준 >= 2), 정상 통과 3/3 (기준 3). 측정일 2026-10-24.
