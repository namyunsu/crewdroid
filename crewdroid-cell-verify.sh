#!/bin/bash
# crewdroid: 셀룰러 수정(fix/macos-cellular-after-distinct) 확인 (약 15분)
# 프라임 에뮬레이터(5582, 5588)와 겹치지 않게 crewdroid는 5560번대 포트를 씀
# 결과: ~/crewdroid-mac-test/cell-verify.log
OUT="$HOME/crewdroid-mac-test"; LOG="$OUT/cell-verify.log"; mkdir -p "$OUT"; : > "$LOG"
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
BP=5560
log() { echo "$*" | tee -a "$LOG"; }
step() { local name="$1"; shift; log ""; log "===== [$name] \$ $*"; local t0=$(date +%s); "$@" >>"$LOG" 2>&1; local rc=$?; log "----- [$name] rc=$rc $(( $(date +%s)-t0 ))s"; return $rc; }

log "cell verify $(date '+%Y-%m-%d %H:%M:%S')"
step "브랜치" bash -c 'cd ~/crewdroid-fix && git fetch -q origin && git checkout -q -B fix/macos-cellular-after-distinct origin/fix/macos-cellular-after-distinct && git log --oneline -3'
step "npm ci" bash -c 'cd ~/crewdroid-fix && npm ci'
step "npm pack" bash -c 'cd ~/crewdroid-fix && rm -f crewdroid-*.tgz && npm pack 2>&1 | tail -5'
step "설치" bash -c 'cd ~/crewdroid-fix && npm i -g ./crewdroid-*.tgz'
step "버전" crewdroid --version

for round in 1 2; do
  step "회차$round up 3대" crewdroid up --count 3 --base-port $BP --json
  for s in emulator-5560 emulator-5562 emulator-5564; do
    step "회차$round $s net online" crewdroid net $s online
    step "회차$round $s net cellular(셀룰러만)" crewdroid net $s cellular
  done
  step "회차$round down" crewdroid down
done

step "run photo-upload" crewdroid run "$(npm root -g)/crewdroid/scenarios/photo-upload.json" --seed 1 --base-port $BP
step "최종 down" crewdroid down

log ""; log "================ 요약"
grep -E '^----- ' "$LOG"
log "RIL 재시작 노트 수: $(grep -c 'restarted the RIL' "$LOG")"
log "로그: $LOG"
