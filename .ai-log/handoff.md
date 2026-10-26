# Handoff (2026-10-26 19:41 shift 4, 3 batches)
이번 shift: T44(hero.gif 슬라이드형, ee5c829 APPROVE), T33(net slow 2MB 업로드: probe http() 감시자 한도를 본문 크기에 비례, 0058e84 APPROVE). T40 은 작업 중 /brief 가 선행 조건(T48·T49·T50)을 바꿔 되돌림, 초안은 .ai-log/evidence/T40-draft.patch.
다음 batch(에뮬레이터 한 번에 하나, 순서): T45(check-net/offline 기존 결함 진단, opus) → T48(데모 앱+클립) → T49(에이전트 벤치) → T50(hero 재제작) → T40(소개, 마지막; 초안 patch 재사용).
알려진 문제: check-net(airplane 인데 업로드 성공, slow→nodata 가 업로드 안 끊음)·check-offline(RETRY p3 timeout)이 원본 코드에서도 실패 = T45. check-slow-upload.mjs:58 .replace(/s+/g) 는 /\s+/g 오타(출력용). src/triage.ts:31 tsc 오류(기존). scripts/demo-vibe.mjs:66 폰트 경로 Windows 하드코딩. platform.ts:92,94 빈 catch.
MANUAL: T43 Mac/Linux 에서 setup→up→shot→down 시간 기록. T44 hero.gif 는 사용자가 이미 구리다고 함(T50 대체).
시나리오(check-scenario)는 T33 후 안 돌림: photoBytes 65536 이라 영향 없다는 추론뿐, 다음 WRAP-UP 전에 한 번 돌릴 것.
워커는 worktree 없이 ai/work 에서 직접 작업. %TEMP%\claude 아래 hero-caps/hero-view/hero.bak 임시 폴더가 남음(권한 거부로 못 지움).
