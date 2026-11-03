#!/bin/bash
# crewdroid: 3대 기동 직후 net online 실패 재현·진단 (약 10~15분)
# 결과: ~/crewdroid-mac-test/net-diag.log
OUT="$HOME/crewdroid-mac-test"; LOG="$OUT/net-diag.log"; mkdir -p "$OUT"; : > "$LOG"
export ANDROID_HOME="$HOME/Library/Android/sdk"
ADB="$ANDROID_HOME/platform-tools/adb"
log() { echo "$*" | tee -a "$LOG"; }
dump() { # 기기 하나의 네트워크 상태
  local s=$1
  log "--- $s 상태 $(date +%H:%M:%S)"
  { "$ADB" -s $s shell "dumpsys connectivity | grep -E 'Active default network|^ *NetworkAgentInfo\{' | cut -c1-220"
    echo "airplane=$("$ADB" -s $s shell settings get global airplane_mode_on) mobile_data=$("$ADB" -s $s shell settings get global mobile_data) wifi_on=$("$ADB" -s $s shell settings get global wifi_on)"
    "$ADB" -s $s shell "dumpsys telephony.registry | grep -E 'mDataConnectionState|mServiceState=' | head -3 | cut -c1-300"
    "$ADB" -s $s shell "ip -br addr | grep -v '^lo'"
    "$ADB" -s $s shell "getprop | grep -E 'gsm.network.type|gsm.operator.alpha|debug.crewdroid' "
    "$ADB" -s $s emu gsm status
    "$ADB" -s $s shell "dumpsys wifi | grep -E '^Wi-Fi is|mWifiInfo' | head -2 | cut -c1-200"
  } >>"$LOG" 2>&1
}
log "net diag $(date '+%Y-%m-%d %H:%M:%S')"
crewdroid down >>"$LOG" 2>&1
for round in 1 2; do
  log ""; log "========== 회차 $round: up --count 3"
  t0=$(date +%s); crewdroid up --count 3 >>"$LOG" 2>&1; log "up rc=$? $(( $(date +%s)-t0 ))s"
  for s in emulator-5580 emulator-5582 emulator-5584; do dump $s; done
  for s in emulator-5580 emulator-5582 emulator-5584; do
    t0=$(date +%s); out=$(crewdroid net $s online 2>&1); rc=$?
    log "net $s online rc=$rc $(( $(date +%s)-t0 ))s: $out"
    if [ $rc -ne 0 ]; then
      dump $s
      log "... 90초 더 기다린 뒤 다시 확인"; sleep 90; dump $s
      t0=$(date +%s); out=$(crewdroid net $s online 2>&1); log "재시도 net $s online rc=$? $(( $(date +%s)-t0 ))s: $out"
    fi
  done
  crewdroid down >>"$LOG" 2>&1
done
log ""; log "========== run photo-upload 재시도"
t0=$(date +%s); crewdroid run "$(npm root -g)/crewdroid/scenarios/photo-upload.json" --seed 1 >>"$LOG" 2>&1; log "run rc=$? $(( $(date +%s)-t0 ))s"
crewdroid down >>"$LOG" 2>&1
log "끝. 로그: $LOG"
