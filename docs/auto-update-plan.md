# Electron 자동 업데이트 설계

## 목표

- 사용자가 1.0.0 설치 상태에서 앱 실행 시 1.0.1 배포본을 자동 감지/다운로드/설치

## 방식

- `electron-builder` + `electron-updater` 사용
- 앱 시작 후 업데이트 체크
- 다운로드 완료 시 사용자에게 재시작 설치 안내 또는 즉시 재시작

## 필수 배포 구성

- macOS: DMG/ZIP + 최신 메타데이터(`latest-mac.yml`)
- Windows: NSIS 설치파일 + 메타데이터(`latest.yml`)
- 업데이트 파일/메타데이터를 접근 가능한 고정 URL에 호스팅

## 현재 설정 상태

- `electron-builder.yml`에 `publish.provider=generic` 설정 존재
- URL이 `https://example.com/auto-updates`로 더미 상태여서 실사용 불가

## 구현 체크리스트

1. 실제 배포 URL 확정(사내 CDN/S3/내부 웹서버)
2. `main` 프로세스에 `autoUpdater` 이벤트 핸들링 추가
3. UI에 업데이트 상태 표시(`checking`, `downloading`, `ready`)
4. 버전 배포 절차 문서화(1.0.0 → 1.0.1)
5. 코드서명(특히 Windows SmartScreen, macOS Gatekeeper 대응) 준비

## 권장 배포 절차(예시)

1. `package.json` 버전 1.0.1로 상승
2. macOS/Windows 빌드 산출
3. 산출물 + `latest*.yml` 업로드
4. 1.0.0 클라이언트 실행 후 업데이트 검증

## 도메인 없이 운영하는 방법

- 도메인 없이도 가능하며, 사내에서 접근 가능한 고정 IP URL을 사용하면 됩니다.
- 예시 URL: `http://192.168.0.20:8080/blackjack-updates`
- 단, `localhost`는 해당 PC 자기 자신만 가리키므로 다수 사용자 업데이트 서버로는 부적합합니다.
