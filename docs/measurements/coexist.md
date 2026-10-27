# 도우미(T52)와 mobile-mcp·Maestro 공존 측정 (T61)

2026-10-27, 에뮬레이터 2대 `up` 직후 첫 기기. 도우미는 요청 없이 3000 ms 지나면 UiAutomation 을 놓는다. 원자료: `coexist.json`.

| 사례 | 결과 | 걸린 시간(ms) | 오류 |
|---|---|---|---|
| a mobile-mcp 1s after up | 성공 | 5667 |  |
| b mobile-mcp 1s after crewdroid screen | 성공 | 5895 |  |
| c mobile-mcp 5s after crewdroid screen | 성공 | 5575 |  |
| d maestro 1s after crewdroid tap | 성공 | 27979 |  |
| e maestro 5s after crewdroid tap | 성공 | 23494 |  |
| f crewdroid screen during maestro flow | 성공 | 14488 |  |

세 번 실행한 중 이 표는 마지막 실행이다. 첫 실행은 a(`Cannot read properties of undefined (reading 'node')`)와 f(`screen` 이 `unexpected screencap size`, Maestro 도 기기 연결 끊김)가 실패했다. 이 마지막 실행에서도 f 중 Maestro 흐름은 실패했다(표의 f 는 `screen` 쪽 결과). 표본이 적어 원인(도우미/부팅 직후 불안정)은 가리지 못했다. 원문: `.ai-log/evidence/T61-*.txt`.
