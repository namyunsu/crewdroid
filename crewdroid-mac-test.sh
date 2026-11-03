#!/bin/bash
# crewdroid macOS 전체 점검 스크립트
# 실행: bash ~/Downloads/crewdroid-mac-test.sh
# 결과: ~/crewdroid-mac-test/test.log (이 파일을 Claude에게 보내면 됨)
# 걸리는 시간: 대략 25~40분. 중간에 실패해도 멈추지 않고 끝까지 돌고, 마지막에 요약표를 찍는다.

OUT="$HOME/crewdroid-mac-test"
LOG="$OUT/test.log"
mkdir -p "$OUT"
: > "$LOG"
SUMMARY=()
S=emulator-5580
PROBE=dev.crewdroid.probe

log() { echo "$*" | tee -a "$LOG"; }

# step <이름> <제한시간초> <명령...> : 명령을 실행하고 출력·종료코드·걸린 시간을 기록
step() {
  local name="$1" limit="$2"; shift 2
  log ""
  log "===== [$name] \$ $*"
  local t0=$(date +%s)
  perl -e 'alarm shift; exec @ARGV' "$limit" "$@" >>"$LOG" 2>&1
  local rc=$?
  local dt=$(( $(date +%s) - t0 ))
  local res="PASS"; [ $rc -ne 0 ] && res="FAIL(rc=$rc)"; [ $rc -eq 142 ] && res="TIMEOUT(${limit}s)"
  log "----- [$name] $res ${dt}s"
  SUMMARY+=("$res | ${dt}s | $name")
}

log "crewdroid mac test $(date '+%Y-%m-%d %H:%M:%S')"

# ---------- 0. 최신 브랜치로 다시 빌드·설치 ----------
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
step "환경정보" 30 bash -c 'sw_vers; uname -m; node -v; "$JAVA_HOME/bin/java" -version 2>&1 | head -1; "$ANDROID_HOME/emulator/emulator" -version 2>/dev/null | head -1; sysctl -n hw.memsize hw.ncpu'
step "이전 기기 정리" 120 crewdroid down
step "브랜치 최신화" 120 bash -c 'cd ~/crewdroid-fix && git checkout fix/macos-npm-install && git pull --ff-only'
step "npm ci" 300 bash -c 'cd ~/crewdroid-fix && npm ci'
step "npm pack (APK 빌드)" 1500 bash -c 'cd ~/crewdroid-fix && rm -f crewdroid-*.tgz && npm pack'
step "패키지 내용 확인" 30 bash -c 'cd ~/crewdroid-fix && tar tzf crewdroid-0.2.2.tgz | grep -E "\.apk$" | sed -E "s#package/load-app/build/fillers/.*#FILLER#" | sort | uniq -c'
step "전역 설치" 300 bash -c 'cd ~/crewdroid-fix && npm i -g ./crewdroid-0.2.2.tgz'
PKG="$(npm root -g)/crewdroid"
step "버전" 30 crewdroid --version
step "setup 점검(설치 안 함)" 120 crewdroid setup
step "apk 분석(기기 불필요)" 60 crewdroid apk "$PKG/probe-app/app/build/outputs/apk/debug/app-debug.apk"

# ---------- 1. 기기 1대 기본 루프 ----------
step "up 1대" 900 crewdroid up
step "devices" 60 crewdroid devices
step "launch probe" 120 crewdroid launch $S $PROBE --restart
step "screen" 60 crewdroid screen $S --bounds
step "screen --json" 60 bash -c "crewdroid screen $S --json | head -c 1500"
step "shot" 60 crewdroid shot $S "$OUT/shot-probe.png"
step "tap --text" 60 crewdroid tap $S --text "Crew Sample"
step "swipe up" 60 crewdroid swipe $S up
step "key back" 60 crewdroid key $S back
step "type (한글 포함)" 60 crewdroid type $S "hello 안녕"
step "logs" 60 crewdroid logs $S $PROBE --since 2m
step "install all" 180 crewdroid install all "$PKG/probe-app/app/build/outputs/apk/debug/app-debug.apk"

# ---------- 2. 기기 환경 ----------
step "env battery" 60 crewdroid env $S battery 42 unplugged
step "env dark on" 60 crewdroid env $S dark on
step "env font 1.3" 60 crewdroid env $S font 1.3
step "env rotate 1" 60 crewdroid env $S rotate 1
step "env rotate 0" 60 crewdroid env $S rotate 0
step "env geo" 60 crewdroid env $S geo 126.978 37.566
step "env gsm roaming" 60 crewdroid env $S gsm data roaming
step "env gsm home" 60 crewdroid env $S gsm data home
step "env sms" 60 crewdroid env $S sms 01012345678 "test sms"
step "env call" 90 crewdroid env $S call 01012345678 cancel
step "env show" 60 crewdroid env $S show
step "env 원복" 60 bash -c "crewdroid env $S dark off && crewdroid env $S font 1.0 && crewdroid env $S battery 100 ac"

# ---------- 3. 네트워크 ----------
step "net airplane" 90 crewdroid net $S airplane
step "net online" 90 crewdroid net $S online
step "net slow" 90 crewdroid net $S slow
step "net flaky" 90 crewdroid net $S flaky
step "net online 2" 90 crewdroid net $S online
step "net cellular" 90 crewdroid net $S cellular
step "net wifi" 120 crewdroid net $S wifi
step "net both" 90 crewdroid net $S both
step "net metered on/off" 90 bash -c "crewdroid net $S metered on && crewdroid net $S metered off"
step "net handover" 120 crewdroid net $S handover --to cellular

# ---------- 4. 앱 제어 ----------
step "app perm show" 60 crewdroid app $S $PROBE perm show
step "app perm grant" 60 crewdroid app $S $PROBE perm grant CAMERA
step "app open deeplink" 60 crewdroid app $S $PROBE open "crewdroid://probe/x"
step "app pressure doze" 90 crewdroid app $S $PROBE pressure doze
step "app pressure reset" 90 crewdroid app $S $PROBE pressure reset
step "app fill-storage 1GB" 180 crewdroid app $S $PROBE fill-storage 1
step "app fill-storage free" 60 crewdroid app $S $PROBE fill-storage free
step "app clear" 60 crewdroid app $S $PROBE clear

# ---------- 5. 진단 ----------
step "triage" 120 crewdroid triage $S --app $PROBE
step "perf" 180 crewdroid perf $S $PROBE

# ---------- 6. load (이번에 고친 것) ----------
step "load low" 900 crewdroid load $S low
step "load off" 600 crewdroid load $S off

# ---------- 7. 레이아웃 점검 (4조합만) ----------
step "layout" 900 crewdroid layout $S $PROBE --profiles s24ultra,fold5-main --fonts 1.0,2.0
step "down 1" 120 crewdroid down

# ---------- 8. 폴드 ----------
step "up fold5" 900 crewdroid up --profiles fold5-main
step "fold" 90 crewdroid fold $S
step "screen 접힘" 60 crewdroid screen $S
step "unfold" 90 crewdroid unfold $S
step "down 2" 120 crewdroid down

# ---------- 9. 여러 대 ----------
step "up 3대" 1500 crewdroid up --count 3
step "devices 3대" 60 crewdroid devices
step "down 3" 120 crewdroid down
step "up 2대 --wifi (맥 미검증 기능)" 1200 crewdroid up --count 2 --wifi
step "wifi 1번" 120 crewdroid net emulator-5580 wifi
step "wifi 2번" 120 crewdroid net emulator-5582 wifi
step "down 4" 120 crewdroid down

# ---------- 10. 시나리오 (3대 + 샘플 서버 + 판정) ----------
step "run photo-upload" 1800 crewdroid run "$PKG/scenarios/photo-upload.json" --seed 1

# ---------- 11. MCP 서버 ----------
step "mcp tools/list" 60 bash -c '(printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"t\",\"version\":\"0\"}}}" "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}" "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}"; sleep 8) | crewdroid mcp | grep -o "\"name\":\"[a-z_]*\"" | sort -u | tr "\n" " "'

# ---------- 마무리 ----------
step "최종 down" 120 crewdroid down
step "남은 crew 프로세스" 30 bash -c 'ps -axo pid,command | grep -E "qemu.*crew-" | grep -v grep || echo "none"'

log ""
log "================ 요약 ================"
for l in "${SUMMARY[@]}"; do log "$l"; done
log ""
log "로그: $LOG"
