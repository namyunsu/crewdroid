# 다자 현장 시나리오 (T10)

`node scripts/check-scenario.mjs` — `crewdroid run scenarios/photo-upload.json --seed N` 를 BUGGY / 정상 서버에 seed 1..3 씩. 원본: `scenario.json`.
기기마다 자기 지연으로 사진·읽기·수정을 8회 반복하고, 네트워크 상태 순서는 기기마다 다르다 (사이사이 online). 동시 누르기 배리어 없음.

| 서버 | seed | exit | outbox 비움 | 위반 (규칙) | 기기 / 네트워크 순서 | 기기별 SYNCED/RETRY/CONFLICT | 전체 s | 호스트 peak CPU / RAM |
|---|---|---|---|---|---|---|---|---|
| BUGGY=1 | 1 | 1 | true (0s) | 5 (noLostUpdate(id,baseVersion)) | s22/API31: airplane>nodata>slow>flaky<br>s24ultra/API34: nodata>slow>flaky>airplane<br>s26ultra/API36: slow>flaky>airplane>nodata | 16/4/0 · 16/10/0 · 16/11/0 | 114 | 44% / 29250 MB |
| clean | 1 | 0 | true (0s) | 0 (-) | s22/API31: airplane>nodata>slow>flaky<br>s24ultra/API34: nodata>slow>flaky>airplane<br>s26ultra/API36: slow>flaky>airplane>nodata | 11/9/5 · 12/7/4 · 13/11/3 | 122 | 47% / 29066 MB |
| BUGGY=1 | 2 | 1 | true (0s) | 7 (noLostUpdate(id,baseVersion)) | s22/API31: airplane>nodata>slow>flaky<br>s24ultra/API34: nodata>slow>flaky>airplane<br>s26ultra/API36: slow>flaky>airplane>nodata | 16/0/0 · 16/10/0 · 16/8/0 | 125 | 46% / 28182 MB |
| clean | 2 | 0 | true (0s) | 0 (-) | s22/API31: airplane>nodata>slow>flaky<br>s24ultra/API34: nodata>slow>flaky>airplane<br>s26ultra/API36: slow>flaky>airplane>nodata | 12/9/4 · 11/10/5 · 14/8/2 | 105 | 43% / 28228 MB |
| BUGGY=1 | 3 | 1 | true (0s) | 6 (count(acks), noLostUpdate(id,baseVersion)) | s22/API31: airplane>nodata>slow>flaky<br>s24ultra/API34: nodata>slow>flaky>airplane<br>s26ultra/API36: slow>flaky>airplane>nodata | 16/5/0 · 16/6/0 · 16/12/0 | 116 | 47% / 28280 MB |
| clean | 3 | 0 | true (0s) | 0 (-) | s22/API31: airplane>nodata>slow>flaky<br>s24ultra/API34: nodata>slow>flaky>airplane<br>s26ultra/API36: slow>flaky>airplane>nodata | 13/10/3 · 9/9/7 · 14/9/2 | 116 | 46% / 28487 MB |

결과: BUGGY 위반 발견 3/3 (기준 >= 2), 정상 통과 3/3 (기준 3). 측정일 2026-10-23.
