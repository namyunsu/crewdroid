#!/bin/bash
# crewdroid: 시스템 재시작 뒤 멈춘 셀룰러를 무엇이 살리는지 (1대, 약 15분)
# 결과: ~/crewdroid-mac-test/cell-fix.log
OUT="$HOME/crewdroid-mac-test"; LOG="$OUT/cell-fix.log"; mkdir -p "$OUT"; : > "$LOG"
export ANDROID_HOME="$HOME/Library/Android/sdk"
ADB="$ANDROID_HOME/platform-tools/adb"
S=emulator-5580
log() { echo "$*" | tee -a "$LOG"; }
sh_() { "$ADB" -s $S shell "$1" >>"$LOG" 2>&1; }
cell() { local st; st=$("$ADB" -s $S shell "dumpsys connectivity | grep -oE 'ni\{MOBILE\[[A-Z]*\] [A-Z_]+' | head -1" 2>/dev/null | awk '{print $2}'); echo "${st:-none}"; }
waitcell() { local lim=$1 t0=$(date +%s); while [ $(( $(date +%s)-t0 )) -lt $lim ]; do [ "$(cell)" = "CONNECTED" ] && { echo "CONNECTED after $(( $(date +%s)-t0 ))s"; return 0; }; sleep 2; done; echo "still $(cell) after ${lim}s"; return 1; }
restart_fw() { # makeDistinct와 같은 재시작
  sh_ "setprop sys.boot_completed 0; stop; start"; sleep 5
  for i in $(seq 1 60); do [ "$("$ADB" -s $S shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 2; done
  "$ADB" -s $S root >/dev/null 2>&1; sleep 3; sh_ "svc wifi disable"; sleep 10
  log "  재시작 후: $(cell)"
}
try() { # try <이름> <명령...>
  local name="$1"; shift
  log ""; log "===== $name"
  restart_fw
  "$@" >>"$LOG" 2>&1
  log "  -> $(waitcell 60)"
}

log "cell fix $(date '+%Y-%m-%d %H:%M:%S')"
log "--- 시작 전 상태"; "$ADB" devices >>"$LOG" 2>&1; ps -axo pid,command | grep -E "qemu-system" | grep -v grep | cut -c1-200 >>"$LOG"
crewdroid down >>"$LOG" 2>&1; sleep 3
log "--- 정리 후"; "$ADB" devices >>"$LOG" 2>&1

crewdroid up >>"$LOG" 2>&1
sh_ "svc wifi disable"; sleep 5
log "기준(재시작 전): $(waitcell 60)"
log "--- 서비스 이름(ril/radio)"; sh_ "getprop | grep -iE 'init.svc.*(ril|radio|modem|cell)'"
log "--- eth0/라우트(재시작 전)"; sh_ "ip -br addr show eth0; ip route; ip rule | head -20"

# 재시작 직후 로그 (원인 파악용)
log ""; log "===== 0. 아무것도 안 함 (재시작만)"
restart_fw
sh_ "logcat -c"; log "  -> $(waitcell 30)"
log "--- eth0/라우트(재시작 후)"; sh_ "ip -br addr show eth0; ip route"
log "--- radio/connectivity 로그"; "$ADB" -s $S shell "logcat -d -b radio,main,system | grep -iE 'DataNetwork|setupData|SETUP_DATA|DataProfile|DataServiceManager|IRadioData|Tethering|eth0|NetworkAgent' | tail -40 | cut -c1-250" >>"$LOG" 2>&1

try "1. svc data 끄고 켜기" bash -c "\"$ADB\" -s $S shell 'svc data disable'; sleep 3; \"$ADB\" -s $S shell 'svc data enable'"
try "2. 비행기모드 켜고 끄기" bash -c "\"$ADB\" -s $S shell 'cmd connectivity airplane-mode enable'; sleep 5; \"$ADB\" -s $S shell 'cmd connectivity airplane-mode disable'"
try "3. eth0 주소 비우고 데이터 끄고 켜기" bash -c "\"$ADB\" -s $S shell 'svc data disable; ip addr flush dev eth0'; sleep 3; \"$ADB\" -s $S shell 'svc data enable'"
try "4. 콘솔 gsm data off/home" bash -c "\"$ADB\" -s $S emu gsm data off; sleep 5; \"$ADB\" -s $S emu gsm data home"
try "5. phone 프로세스 종료(자동 재시작)" bash -c "\"$ADB\" -s $S shell 'kill \$(pidof com.android.phone)'"
try "6. radio HAL 서비스 재시작" bash -c "for n in \$(\"$ADB\" -s $S shell \"getprop | grep -oE 'init.svc.[^]]*(ril|radio)[^]]*'\" | sed 's/init.svc.//'); do echo restart \$n; \"$ADB\" -s $S shell \"setprop ctl.restart \$n\"; done; sleep 5"
try "7. cmd phone 모뎀 재시작" bash -c "\"$ADB\" -s $S shell 'cmd phone restart-modem' ; \"$ADB\" -s $S shell 'cmd phone help' | grep -iE 'modem|radio|data' | head -10"

crewdroid down >>"$LOG" 2>&1
log ""; log "끝. 로그: $LOG"
