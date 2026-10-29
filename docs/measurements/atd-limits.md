# What the google_atd images lack (T76)

Date: 2026-10-29 · raw: `atd-limits.json` · script: `node scripts/check-atd-limits.mjs --apis 31,34,36 --write` (re-check one API: `node scripts/check-atd-limits.mjs`)
Each API on a fresh crew device (profile s22, one device at a time). WebView check: the probe app's `check=webview` loads `http://10.0.2.2:<port>/` from a tiny host server (title "crewdroid webview page"). Intents: `cmd package resolve-activity --brief`; packages: `pm path`.

| | API 31 | API 34 | API 36 |
|---|---|---|---|
| WebView provider (`dumpsys webviewupdate`) | `com.android.webview` 91.0.4472.114 | `com.android.webview` 113.0.5672.136 | `com.android.webview` 133.0.6943.137 |
| App WebView renders a local page | yes (`ok title=crewdroid webview page`) | yes (`ok title=crewdroid webview page`) | yes (`ok title=crewdroid webview page`) |
| `VIEW https://example.com` resolves to | `com.android.fakesystemapp/.browser.StubBrowserActivity` | `com.android.fakesystemapp/.browser.StubBrowserActivity` | chooser: `com.android.fakesystemapp/.browser.StubBrowserActivity`, `org.chromium.webview_shell/.WebViewBrowserActivity` |
| `IMAGE_CAPTURE` resolves to | nothing | nothing | `com.android.camera2/com.android.camera.CaptureActivity` |
| `MAIN/HOME` resolves to | `com.android.fakesystemapp/.launcher.EmptyHomeActivity` | `com.android.fakesystemapp/.launcher.EmptyHomeActivity` | `com.android.fakesystemapp/.launcher.EmptyHomeActivity` |
| `SEND text/plain` resolves to | chooser: `com.android.bluetooth/.opp.BluetoothOppLauncherActivity`, `com.android.nfc/.BeamShareActivity`, `com.google.android.gms/.nearby.sharing.ShareSheetActivity` | chooser: `com.google.android.bluetooth/com.android.bluetooth.opp.BluetoothOppLauncherActivity`, `com.google.android.gms/.nearby.sharing.ShareSheetActivity` | chooser: `com.google.android.bluetooth/com.android.bluetooth.opp.BluetoothOppLauncherActivity`, `com.google.android.gms/.nearby.sharing.send.SendActivity` |
| `PICK_IMAGES` resolves to | nothing | `com.google.android.providers.media.module/com.android.providers.media.photopicker.PhotoPickerActivity` | `com.google.android.providers.media.module/com.android.providers.media.photopicker.PhotoPickerActivity` |
| `VIEW market://details` resolves to | nothing | nothing | nothing |
| `ADD_ACCOUNT_SETTINGS` resolves to | nothing | nothing | nothing |
| `com.google.android.gms` installed | yes, `/product/priv-app/PrebuiltGmsCore` 22.50.14 (190800-499278674) | yes, `/product/priv-app/PrebuiltGmsCore` 23.18.18 (190800-535401451) | yes, `/product/priv-app/PrebuiltGmsCore` 25.08.34 (260800-739221510) |
| `com.android.vending` installed | yes, `/product/app/LicenseChecker` 1.8 | yes, `/product/app/LicenseChecker` 1.8 | yes, `/product/app/LicenseChecker` 1.8 |
| `com.android.chrome` installed | no | no | no |
| Accounts on the device (`dumpsys account`) | 0 | 0 | 0 |
