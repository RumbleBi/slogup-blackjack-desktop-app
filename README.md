# Slogup Blackjack Desktop App

사내 슬로거들을 위한 멀티플레이 블랙잭 데스크톱 앱입니다.
Electron + React + Supabase 기반으로 동작하며, GitHub Releases를 통한 자동 업데이트를 지원합니다.

## 1) 앱 소개

- 딜러는 컴퓨터, 플레이어는 방 단위로 참여
- 로비에서 방 생성/입장, 닉네임 변경 가능
- 방 상태(`waiting` / `in_game`) 기반으로 입장 정책 제어
- 게임 로그, 라운드 결과, 리더보드 UI 제공
- 앱 시작 시 자동 업데이트 확인 및 설치 흐름 지원

## 2) 기술 스택

- Electron
- React + TypeScript
- Tailwind CSS
- Supabase (`@supabase/supabase-js`)
- Electron Updater (`electron-updater`)
- Electron Builder (`electron-builder`)

## 3) 실행 환경

- Node.js 20+
- npm 10+
- macOS / Windows
- Supabase 프로젝트 및 DB 스키마 적용

## 4) 환경 변수 설정

루트에 `.env` 파일 생성:

```env
VITE_SUPABASE_URL=YOUR_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=YOUR_SUPABASE_ANON_KEY
```

참고: `.env`는 git에 올리지 않습니다.

## 5) Supabase 초기 설정

- 파일: `supabase/schema.sql`
- Supabase SQL Editor에서 전체 실행

포함 내용:

- 테이블 생성 (`rooms`, `room_players`, `games`, `game_logs` 등)
- 재접속 관련 RPC 함수
- 로그 30일 정리 함수/스케줄

## 6) 개발 실행

```bash
npm install
npm run dev
```

## 7) 빌드

```bash
# 공통 빌드(타입체크 + 번들)
npm run build

# 플랫폼별 패키징
npm run build:mac
npm run build:win
npm run build:linux
```

## 8) GitHub Release 배포 (자동업데이트용)

이 프로젝트는 `electron-builder.yml`에서 GitHub publish를 사용합니다.

### 8-1. 사전 준비

1. GitHub PAT 준비 (`GH_TOKEN`)
2. 토큰 권한 권장:

- Classic token: `repo`
- 또는 Fine-grained: 대상 repo 선택 + `Contents: Read and write`

3. 쉘에 토큰 설정:

```bash
echo "export GH_TOKEN='YOUR_TOKEN'" >> ~/.zshrc
source ~/.zshrc
echo ${GH_TOKEN:+SET}
```

### 8-2. 버전 지정 (수동)

자동 patch 증가 대신 수동 버전 지정 방식:

```bash
npm run release:set --version=1.0.1
```

### 8-3. 태그 + 업로드

#### mac 배포

```bash
npm run release:manual:mac
```

#### Windows 배포

Windows 환경에서 실행 권장:

```bash
npm run release:manual:win
```

### 8-4. 업로드 확인

GitHub Releases의 해당 태그에 아래 파일이 보여야 정상:

- mac: `.dmg`, `.zip`, `latest-mac.yml`
- win: `.exe`, `latest.yml`

## 9) 자동 업데이트 동작

- 앱 시작 시 업데이트 확인
- 새 버전이 있으면 다운로드 진행
- 다운로드 완료 후 재시작 설치

주의:

- GitHub Release에 `latest*.yml`과 설치 파일이 없으면 업데이트가 동작하지 않습니다.
- "No published versions on GitHub" 메시지는 릴리스 자산이 아직 없을 때 발생합니다.
