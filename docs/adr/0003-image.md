# 0003 이미지 전략 — 네이티브 앱은 ATD, 안 되는 것만 google_apis

- 날짜: 2026-10-23 · 상태: 실측 근거 있음 (T02), T04에서 API 31/36 추가 확인
- 결정: 기본 이미지는 `system-images;android-34;google_atd;x86_64` (AVD `crew-android-34-google_atd`, 1080x2340, `-cores 2 -memory 2048`). ATD에서 실패하는 시나리오(Chrome·실제 카메라 앱·런처·갤러리 필요)만 `google_apis` 이미지로 따로 띄운다.
- 근거 (`node scripts/check-atd.mjs --image android-34/google_atd --port 5580`, 원문 로그):

```
CrewProbe: CAMERA ok 8977 bytes
CrewProbe: PICKER ok PICK_IMAGES content://media/picker/0/com.android.providers.media.photopicker/media/1000000020 18340 bytes
CrewProbe: UPLOAD ok 8977
```

- CAMERA: Camera2로 에뮬레이트 후면 카메라에서 JPEG 1장 캡처 성공. 카메라 "앱"은 ATD에 없으므로 앱이 Camera2/CameraX로 직접 찍는 경우만 해당한다. `ACTION_IMAGE_CAPTURE` 인텐트는 처리할 앱이 없다고 보고 google_apis로 가야 한다 [모름: 이번에 인텐트 경로는 측정하지 않음].
- PICKER: `ACTION_PICK_IMAGES`가 ATD에서 해석됨(MediaProvider 포토피커). `/sdcard/Pictures`에 push한 이미지를 `uiautomator dump`로 타일(content-desc `Photo taken on ...`)을 찾아 `input tap`으로 자동 선택. 선택된 항목은 가장 앞 타일이라 push한 파일이 아닐 수 있다(카메라 결과일 수 있음). 선택 자체와 읽기(18340 bytes)는 성공.
- UPLOAD: 에뮬레이터에서 `10.0.2.2:<port>`로 multipart POST 성공(`sample/server/server.ts`가 받은 바이트 수를 응답).
- 주의: ATD 이미지에는 Chrome·카메라 앱·갤러리·런처가 없다(CLAUDE.md). 런처가 없으므로 앱 실행은 `am start -n`으로만 한다.

## 화면이 검게 나오던 원인 (T14, 2026-10-23)

- 원인: ATD 이미지의 `/system/build.prop` 114행(`PRODUCT_SYSTEM_DEFAULT_PROPERTIES`)에 `debug.hwui.drawing_enabled=0` 이 들어 있다. 앱 HWUI가 프레임을 아예 그리지 않으므로 SurfaceFlinger가 합성할 버퍼가 없다(`dumpsys SurfaceFlinger`: 앱 BufferStateLayer `activeBuffer=[0x0:0]`, Composition `0 Layers`). 그래서 screencap은 전부 검정이고, 창을 띄우면 마지막으로 그려진 부팅 로고에 멈춘다. GPU 모드·스냅샷·창 유무와 무관하다: API 31을 스냅샷 없이 콜드 부팅(`-no-snapshot-load`)해도 똑같이 100% 검정이었다. 카메라 영상만 보였던 것은 영상이 HWUI를 거치지 않는 경로(Surface에 디코더/카메라가 직접 씀)이기 때문이다.
- 확인: API 31 콜드 부팅, 프로브 앱 실행 상태에서 screencap 검정 1색(100%) → `adb shell setprop debug.hwui.drawing_enabled 1` 후 앱 재실행 → 앱 화면(최빈색 #f0f0f3 92.7%, 432색).
- 해결: `up`이 부팅 직후 기기마다 `setprop debug.hwui.drawing_enabled 1` 을 건다(`src/up.ts`). `persist.` 속성이 아니라 부팅마다 다시 걸어야 하고, 이미 떠 있던 프로세스는 옛 값을 쓰므로 이후 실행한 앱부터 그려진다. 이미지 교체·다운로드는 필요 없다.
- 창: `up --window` 는 `-no-window` 를 빼고 띄운다(사람이 보는 용도, 콘솔 창은 최소화). 3대(API 31/34/36) 모두 창에 앱 화면이 나왔다(`.ai-log/evidence/T14-window-55*.png`).
- 검증: `node scripts/check-render.mjs` (3대 up → 프로브 앱 → screencap, 한 색이 99% 넘으면 실패, 결과 PNG `docs/measurements/render-*.png`).
