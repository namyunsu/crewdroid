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
