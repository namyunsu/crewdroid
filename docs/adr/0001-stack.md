# 0001 구글 에뮬레이터 위 Node.js + TypeScript CLI

- 날짜: 2026-10-23 · 상태: 확정 (사용자)
- 결정: 가상화를 새로 만들지 않고 Android SDK emulator 위에 CLI 를 얹는다. 언어는 Node.js + TypeScript.
- 이유: npx 로 바로 실행, Windows/mac/Linux 공통(오픈소스 공개 전제), private-app harness.ts·mobile-mcp 와 같은 생태계.
- 대안: PowerShell(Windows 전용), Python.
