# 0008 프록시 판정 — 서버·앱을 안 고치고 요청 기록으로 중복·덮어쓰기·유실 판정

- 날짜: 2026-10-28 · 상태: 실측 근거 있음 (T69, API 31/34/36)
- 결정: `crewdroid proxy start --target http://host:port [--port 5590] [--devices ...]` 가 호스트에 기록용 HTTP 프록시를 띄우고, 기기마다 `settings put global http_proxy 10.0.2.2:<port+k>` 로 시스템 프록시를 건다. 앱·서버·기동 플래그·AVD 설정·`KNOBS` 는 그대로다. 요청마다 JSONL 한 줄을 남기고, `crewdroid judge --rules judge/proxy.rules.json --log proxy.jsonl` 이 `dupSuccess` / `lostUpdate` / `lostWrite` / `idle` 을 판정한다. `/export` 판정(`unique` / `count` / `noLostUpdate`)은 그대로 남는다(고급 선택지). 규칙 파일 하나에 둘을 섞어도 된다(`--source` 와 `--log` 를 같이 준다).
- 확인: `npm test && node scripts/check-proxy.mjs`, 측정 `docs/measurements/proxy.md`, HTTPS 조사 `docs/measurements/proxy-tls.txt`

## 왜 최종 상태 판정만으로는 모자라나
`/export` 판정은 서버가 남긴 데이터만 본다. DB 제약이 거절한 중복, 이력 없이 덮어쓴 값, `acks` 표가 없는 서버는 보이지 않는다. 프록시는 서버가 "몇 번, 무엇을 2xx 로 답했는지"를 본다. 그래서 서버에 `/export`·`acks`·`baseVersion` 이력이 없어도 판정한다.

## 기기 구분
에뮬레이터 트래픽은 모두 호스트의 127.0.0.1 에서 나오므로 출발 주소로는 기기를 못 가른다. 그래서 기기마다 리슨 포트를 하나씩 준다(`--port` 부터 차례로). 로그의 `device` 는 그 포트의 serial 이다. `--devices` 가 없으면 지금 떠 있는 crew 에뮬레이터 전부.

## 어디로 보내나
- origin-form(앱이 프록시 주소를 직접 쓴 경우)과 `http://10.0.2.2:*` absolute-form(시스템 프록시를 거친 앱 요청) → `--target`.
- 다른 호스트의 absolute-form(예: OS 의 captive portal 확인 `GET /generate_204`) → 원래 호스트로 그대로 넘기고 `host` 를 붙여 기록한다. 처음에는 모든 평문 요청을 `--target` 으로 보냈는데, 실측에서 OS 의 `/generate_204` 가 sample server 의 404 를 받았다 [확인함 T69 기기 실험 로그]. 망 검증을 깨뜨릴 수 있어 바꿨다.
- `CONNECT`(HTTPS) → 내용을 보지 않고 터널만 이어 준다(호스트:포트만 기록). 프록시를 건 동안 기기의 HTTPS 가 끊기지 않게 하기 위해서다. 실측에서 `*.googleapis.com:443` 터널이 계속 보였다 [확인함].
- 판정 규칙은 `host` 가 붙은 줄과 `CONNECT` 줄을 빼고 본다(시험 대상 서버 트래픽만).

## 규칙
| 규칙 | 뜻 | 같은 쓰기의 기준 |
|---|---|---|
| `dupSuccess()` | 같은 쓰기가 2xx 를 두 번 이상, **서로 다른 응답 본문**으로 받았다 = 서버가 두 번 적용했다 | idempotency-key(`idempotency-key` / `x-idempotency-key`), 없으면 기기+메서드+경로+본문 해시 |
| `lostUpdate(pattern, ver)` | 같은 리소스(`/records/:id`)에 같은 버전 기준으로 서로 다른 PUT/PATCH 가 둘 다 2xx | ver = 요청 본문 JSON pointer(`/version`) 또는 헤더 이름(`If-Match`) |
| `lostWrite(N)` | 쓰기가 실패(응답 없음·5xx·응답 끊김)했는데 같은 쓰기가 N 초 안에 다시 오지 않았다 | 위와 같음 |
| `idle(N)` | 로그에 나온 기기 모두 마지막 N 초 동안 요청이 없다(T55 의 "큐 비움") | — |

명세 문구("2xx more than once")에서 바꾼 점: 같은 키에 **같은** 2xx 본문이 다시 오면 서버 멱등 처리가 제대로 된 재생(replay)이다. 정상 sample server 는 재시도에 첫 응답을 그대로 돌려주므로, 본문까지 같으면 중복으로 치지 않는다 [확인함 `test/proxy.test.ts`]. 같은 이유로 `lostUpdate` 는 같은 키의 재시도를 한 쓰기로 본다. 한계: 서버가 재생 응답에 매번 새 시각 같은 값을 넣으면 `dupSuccess` 가 거짓 양성을 낸다.

`lostWrite` 는 판정 시각 기준 N 초가 안 지난 실패는 아직 판정하지 않는다(앱이 곧 재시도할 수 있다). 4xx 는 서버의 확정 답이라 실패로 치지 않는다. 기기가 아예 보내지 못한 쓰기(비행기 모드 중 앱 안에 머문 것)는 프록시가 볼 수 없다. 그것은 앱 쪽 outbox 로 본다.

## 응답 유실 주입 (`--lose-acks P`)
BUGGY 서버의 "멱등 키 무시" 버그는 서버가 저장한 직후 응답이 사라지고 앱이 재시도할 때만 드러난다. 자연 실행에서는 그 창이 몇 ms 라 거의 안 걸린다. 기존 `scenario.md` 의 BUGGY 6회에서 `unique(key)` 는 한 번도 안 떴다 [확인함 docs/measurements/scenario.md]. 그래서 프록시에 선택형 결함 주입을 넣었다. 쓰기 요청 중 P 비율은 서버 응답을 받은 뒤 클라이언트 연결을 끊는다(로그 `cut: true`). 읽기는 끊지 않는다. seed 로 재현된다. 정상 서버는 같은 주입 아래에서도 모든 규칙을 통과해야 하므로(재생 응답이 같다), 주입이 판정을 거짓으로 만들지 않는다는 것도 같은 실행에서 확인한다.

## 시스템 프록시를 무시하는 앱 (판정 밖)
`settings put global http_proxy` 는 `java.net` / OkHttp / HttpURLConnection 의 기본 ProxySelector 를 따르는 앱에만 걸린다 [추론: Android 가 프록시 변경 시 앱 프로세스의 `http.proxyHost` 를 바꾼다. 실측은 probe 앱(HttpURLConnection)과 OS 서비스만]. 다음은 프록시를 우회한다.
- 자기 프록시 설정을 쓰거나 `Proxy.NO_PROXY` 를 지정한 클라이언트(OkHttp `proxy(Proxy.NO_PROXY)` 등)
- 원시 소켓·WebSocket 라이브러리가 프록시를 안 읽는 경우, gRPC-netty 일부
- Cronet / QUIC(HTTP/3, UDP), Flutter `dart:io` HttpClient(기본은 시스템 프록시 안 읽음), React Native 일부 버전
- 인증서 고정(pinning)한 HTTPS: 터널은 통과하지만 내용은 어차피 못 본다
이런 앱은 앱이 서버 주소를 `http://10.0.2.2:<proxy port>` 로 바꿔 쓰면(origin-form) 같은 로그·판정을 쓸 수 있다. 다만 그건 앱 설정 변경이다.

해제: `proxy stop` 은 기기마다 `settings put global http_proxy :0` 을 한다(설정을 지워도 캐시된 값이 남는 경우가 있어 `:0` 을 쓴다). 그 뒤 앱 요청이 직접 서버로 가는 것까지 확인했다 [확인함 check-proxy]. `down` 은 떠 있는 `proxy start` 작업 프로세스를 끝낸다. 클론은 `-read-only` 라 설정이 클론과 함께 사라진다. 새 클론의 값은 `null` [확인함 check-proxy].

## HTTPS: 시스템 CA 를 넣을 수 있나 — 근거
세 이미지 모두 `userdebug` 이다. `adb root` 셸(`u:r:su:s0`)이고 SELinux 는 Enforcing, `/system/bin/nsenter` 가 있다. 루트(`/`)는 `ro` ext4(dm-verity) [확인함 proxy-tls.txt]. 기동 플래그를 바꾸지 않는 방법(`-writable-system` 금지)으로 시험했다.

| API | CA 저장소 | 방법 | 새로 띄운 앱 프로세스에서 보이나 |
|---|---|---|---|
| 31 | `/system/etc/security/cacerts` (129개) | 원본을 `/data/local/tmp` 에 복사 → 그 위에 tmpfs 마운트 → 원본 + 새 파일 복사, `chcon u:object_r:system_file:s0` | 예: `/proc/<새 앱 pid>/root/.../crewtest.0` 이 `system_file` 라벨로 보인다 |
| 34 | `/apex/com.android.conscrypt/cacerts` (134개) | 위 tmpfs 를 만든 뒤 `/apex/.../cacerts` 에 bind, `nsenter --mount=/proc/<zygote64>/ns/mnt` 로 zygote 네임스페이스에도 bind | 예 (zygote 에서 갈라진 새 앱 프로세스) |
| 36 | `/apex/com.android.conscrypt/cacerts` (149개) | 34 와 같음 | 예 |

`umount` 로 되돌리면 개수가 원래대로 돌아왔다(129/134/149) [확인함 proxy-tls.txt]. 이미 떠 있던 앱 프로세스에는 반영되지 않는다(앱을 다시 시작해야 함) [추론: 마운트 네임스페이스가 fork 시점에 복사됨].

결론: **파일 수준에서는 가능하다.** 하지만 T69 에서는 `--tls` 를 구현하지 않았다. 이유는 다음과 같다.
1. MITM 에는 CA 와 호스트별 서버 인증서 발급(X.509 서명)이 필요하다. `node:crypto` 는 X.509 를 읽기만 하고 만들지 못한다. 그래서 새 의존성(예: node-forge)이나 호스트의 `openssl` 실행 파일이 필요하다. 이 Todo 의 "새 의존성 없음" 조건과 부딪친다.
2. 시험한 것은 가짜 파일(`crewtest.0`)이 앱 네임스페이스에 보이는지까지다. 진짜 CA 로 앱의 TLS 검증이 통과하는지는 확인하지 않았다 [모름]. ATD 에는 브라우저가 없고 probe 앱은 HTTP 만 쓴다.
3. 앱이 `network_security_config` 로 사용자/시스템 CA 를 제한하거나 인증서를 고정하면, 시스템 CA 를 넣어도 소용없다.
지금은 HTTP 만 판정한다. HTTPS 서버는 시험 때 평문 포트를 하나 열거나(앱의 서버 주소만 바꿈) 별도 Todo 로 `--tls`(CA 생성 방법 결정 + 위 마운트 절차 + 앱 재시작 + 실제 HTTPS 요청 검증)를 만든다.
