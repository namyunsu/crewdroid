#!/bin/bash
# crewdroid: run 시나리오 끝까지 확인 (약 15~20분)
# 1) 서버 없이 run → 기기 띄우기 전에 바로 안내 에러가 나야 함
# 2) 버그 있는 샘플 서버(BUGGY=1)로 run → FAIL(위반 발견, exit 1)이 정상
# 3) 고친 샘플 서버로 run → OK(위반 0, exit 0)가 정상
# 프라임 에뮬레이터와 겹치지 않게 5560번대 포트 사용
# 결과: ~/crewdroid-mac-test/run-verify.log
OUT="$HOME/crewdroid-mac-test"; LOG="$OUT/run-verify.log"; mkdir -p "$OUT"; : > "$LOG"
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
BP=5560; SP=5599
log() { echo "$*" | tee -a "$LOG"; }
step() { local name="$1"; shift; log ""; log "===== [$name] \$ $*"; local t0=$(date +%s); "$@" >>"$LOG" 2>&1; local rc=$?; log "----- [$name] rc=$rc $(( $(date +%s)-t0 ))s"; return $rc; }

log "run verify $(date '+%Y-%m-%d %H:%M:%S')"
step "브랜치" bash -c 'cd ~/crewdroid-fix && git fetch -q origin && git checkout -q -B fix/macos-cellular-after-distinct origin/fix/macos-cellular-after-distinct && git log --oneline -4'
step "npm ci" bash -c 'cd ~/crewdroid-fix && npm ci'
step "npm pack" bash -c 'cd ~/crewdroid-fix && rm -f crewdroid-*.tgz && npm pack 2>&1 | tail -3'
step "설치" bash -c 'cd ~/crewdroid-fix && npm i -g ./crewdroid-*.tgz'
PKG="$(npm root -g)/crewdroid"
SC="$PKG/scenarios/photo-upload.json"
crewdroid down >>"$LOG" 2>&1

step "1. 서버 없이 run (바로 안내 에러가 정상)" crewdroid run "$SC" --seed 1 --base-port $BP --server-port $SP

DATA=$(mktemp -d)
log ""; log "--- 버그 서버 시작 (BUGGY=1, 데이터 $DATA)"
(cd "$PKG" && BUGGY=1 DATA_DIR="$DATA" npx -y tsx sample/server/main.ts $SP) >>"$OUT/server-buggy.log" 2>&1 &
SRV=$!; sleep 8; curl -s -o /dev/null -w "서버 응답 %{http_code}\n" http://127.0.0.1:$SP/export | tee -a "$LOG"
step "2. 버그 서버로 run (FAIL·exit 1이 정상)" crewdroid run "$SC" --seed 1 --base-port $BP --server-port $SP
kill $SRV 2>/dev/null; pkill -f "sample/server/main.ts $SP" 2>/dev/null; sleep 2

DATA2=$(mktemp -d)
log ""; log "--- 고친 서버 시작 (데이터 $DATA2)"
(cd "$PKG" && DATA_DIR="$DATA2" npx -y tsx sample/server/main.ts $SP) >>"$OUT/server-fixed.log" 2>&1 &
SRV=$!; sleep 8; curl -s -o /dev/null -w "서버 응답 %{http_code}\n" http://127.0.0.1:$SP/export | tee -a "$LOG"
step "3. 고친 서버로 run (OK·exit 0이 정상)" crewdroid run "$SC" --seed 1 --base-port $BP --server-port $SP
kill $SRV 2>/dev/null; pkill -f "sample/server/main.ts $SP" 2>/dev/null

step "최종 down" crewdroid down
log ""; log "================ 요약"
grep -E '^----- |^(OK|FAIL|VIOLATION|error)' "$LOG"
log "로그: $LOG"
