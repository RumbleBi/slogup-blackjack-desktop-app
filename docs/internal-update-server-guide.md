# 사내 서버(자동 업데이트용) 설명

## 사내 서버가 의미하는 것

Electron 자동업데이트에서 말하는 사내 서버는,
앱 설치 파일과 업데이트 메타데이터 파일(`latest.yml`, `latest-mac.yml`)을 **HTTP/HTTPS로 내려주는 내부 파일 서버**를 의미합니다.

즉, 특별한 새 제품이 아니라 아래 중 하나면 충분합니다.

- 사내 Nginx/Apache 웹서버
- 사내 NAS + 정적 파일 웹 호스팅
- 사내 인트라넷 파일 배포 서버
- 사내 오브젝트 스토리지(사설 S3 호환) + 정적 서빙

## 필요한 파일

각 버전 배포 시 아래 파일들을 같은 경로에 업로드합니다.

- Windows: `blackjack-app-1.0.1-setup.exe`, `latest.yml`
- macOS: `blackjack-app-1.0.1.dmg`, `latest-mac.yml` (및 zip 산출물)

## 앱에서 필요한 설정

`electron-builder.yml`의 `publish.url`을 실제 내부 URL로 바꾸면 됩니다.

예시:

```yaml
publish:
  provider: generic
  url: http://192.168.0.20:8080/blackjack-updates
```

이후 1.0.0 사용자가 앱 실행 시,
앱이 `http://192.168.0.20:8080/blackjack-updates/latest*.yml`을 조회하고 1.0.1 파일을 자동 다운로드합니다.

## localhost 사용 가능 여부

- `http://localhost:포트`는 **업데이트 서버를 실행하는 그 PC에서만** 동작합니다.
- 여러 직원 PC가 업데이트를 받아야 한다면 `localhost`는 사용할 수 없습니다.
- 도메인이 없어도 괜찮고, 공유 가능한 사내 IP(`http://192.168.x.x:포트/...`)면 충분합니다.
