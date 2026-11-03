#!/bin/bash
# crewdroid: 시스템 재시작(makeDistinct) 뒤 셀룰러가 CONNECTING에 멈추는지, 무엇으로 살아나는지 (약 10분)
# 결과: ~/crewdroid-mac-test/cell-diag.log
OUT="$HOME/crewdroid-mac-test"; LOG="$OUT/cell-diag.log"; mkdir -p "$OUT"; : > "$LOG"
export ANDROID_HOME="$HOME/Library/Android/sdk"
ADB="$ANDROID_HOME/platform-tools/adb"
log() { echo "$*" | tee -a "$LOG"; }
cell() { # 셀룰러 상태 한 줄: CONNECTED / CONNECTING / none
  local s=$1 st
  st=$("$ADB" -s $s shell "dumpsys connectivity | grep -oE 'ni\{MOBILE\[[A-Z]*\] [A-Z_]+' | head -1" 2>/dev/null | awk '{print $2}')
  echo "${st:-none}"
}
waitcell() { # 최대 $2초 동안 CONNECTED 기다림
  local s=$1 lim=$2 t0=$(date +%s)
  while [ $(( $(date +%s)-t0 )) -lt $lim ]; do [ "$(cell $s)" = "CONNECTED" ] && { echo "CONNECTED after $(( $(date +%s)-t0 ))s"; return 0; }; sleep 2; done
  echo "still $(cell $s) after ${lim}s"; return 1
}
sh_() { "$ADB" -s $1 shell "$2" >>"$LOG" 2>&1; }

log "cell diag $(date '+%Y-%m-%d %H:%M:%S')"
crewdroid down >>"$LOG" 2>&1

log ""; log "===== A. 1대 + 시스템 재시작(makeDistinct와 같은 stop/start)"
crewdroid up >>"$LOG" 2>&1; S=emulator-5580
sh_ $S "svc wifi disable"
log "A1 재시작 전 셀룰러: $(waitcell $S 60)"
sh_ $S "setprop sys.boot_completed 0; stop; start"
sleep 5
for i in $(seq 1 60); do [ "$("$ADB" -s $S shell getprop sys.boot_completed | tr -d '\r')" = "1" ] && break; sleep 2; done
"$ADB" -s $S root >>"$LOG" 2>&1; sleep 3
sh_ $S "svc wifi disable"
log "A2 재시작 후 셀룰러: $(waitcell $S 60)"
crewdroid down >>"$LOG" 2>&1

log ""; log "===== B. 3대 띄운 뒤 멈춘 기기 살리기 시도"
crewdroid up --count 3 >>"$LOG" 2>&1
for S in emulator-5580 emulator-5582 emulator-5584; do sh_ $S "svc wifi disable"; done
sleep 5
for S in emulator-5580 emulator-5582 emulator-5584; do log "B0 $S 셀룰러(와이파이 끔): $(waitcell $S 30)"; done
S=emulator-5582
log "B1 svc data disable/enable"; sh_ $S "svc data disable"; sleep 3; sh_ $S "svc data enable"; log "   -> $(waitcell $S 40)"
log "B2 비행기모드 on/off"; sh_ $S "cmd connectivity airplane-mode enable"; sleep 5; sh_ $S "cmd connectivity airplane-mode disable"; log "   -> $(waitcell $S 60)"
log "B3 콘솔 gsm data off/on"; "$ADB" -s $S emu gsm data off >>"$LOG" 2>&1; sleep 5; "$ADB" -s $S emu gsm data home >>"$LOG" 2>&1; log "   -> $(waitcell $S 40)"
log "B4 RIL 재시작"; sh_ $S "getprop | grep -iE 'init.svc.*ril'"; sh_ $S "setprop ctl.restart vendor.ril-daemon"; log "   -> $(waitcell $S 60)"
log "B5 phone 프로세스 재시작"; sh_ $S "am crash com.android.phone || pkill -f com.android.phone"; log "   -> $(waitcell $S 60)"
S=emulator-5584
log "B6 (5584) 비행기모드 on/off만"; sh_ $S "cmd connectivity airplane-mode enable"; sleep 5; sh_ $S "cmd connectivity airplane-mode disable"; log "   -> $(waitcell $S 60)"
log ""; log "B7 멈춘 기기 상세 (5580)"
sh_ emulator-5580 "dumpsys connectivity | grep -E '^ *NetworkAgentInfo\{' | cut -c1-260"
sh_ emulator-5580 "logcat -d -b radio | grep -iE 'setupdatacall|SETUP_DATA_CALL|DataNetwork|fail|error' | tail -25"
crewdroid down >>"$LOG" 2>&1
log "끝. 로그: $LOG"
