# 아키텍처 초안 (MVP)

## 클라이언트 구조

- Electron Main Process
  - 앱 라이프사이클
  - 자동 업데이트 체크/다운로드/설치
  - 보안 IPC 브리지
- Renderer (React + Tailwind)
  - 화면: 닉네임 입력, 로비, 방 생성, 게임방, 게임 테이블
  - 상태: 유저 세션(닉네임), 현재 방, 게임 상태

## Supabase 구성

- Database (PostgreSQL)
  - `profiles`: 익명 닉네임 세션
  - `rooms`: 방 메타데이터
  - `room_players`: 참가자/레디/방장 여부
  - `games`: 게임 라운드/상태
  - `game_players`: 플레이어별 자산/탈락 여부
  - `actions`: 다이/콜/하프 로그
  - `chat_messages`: 방 채팅
- Realtime
  - 방 목록 변동
  - 참가자/레디 상태
  - 채팅
  - 게임 진행 이벤트
- Edge Functions (권장)
  - 턴 검증
  - 베팅/승패 정산
  - 연결 끊김 처리(서버 기준)

## 권한 모델(초안)

- Supabase Auth 없이 익명 세션 키 발급(앱 로컬 저장)
- RLS 정책으로 `세션 키 + 방 참가 여부` 기준 접근 제한
- 서버 함수에서 게임 상태 전이 강제(클라 직접 조작 방지)

## 게임 상태 머신(초안)

1. `WAITING` (로비 대기)
2. `READY_CHECK` (전원 READY 확인)
3. `IN_ROUND` (턴 기반 진행)
4. `ROUND_SETTLEMENT` (정산)
5. `ROOM_FINISHED` (우승자 확정)

## 연결 끊김 처리(초안)

- `last_seen_at` heartbeat(예: 5초 갱신)
- 임계 시간 초과 시 `DISCONNECTED_LOSE` 처리

## 우선 구현 순서

1. 로비/방생성/방입장/채팅/레디
2. 최소 게임 루프(자동 베팅 + 턴 행동 + 정산)
3. 탈락/우승 조건
4. 자동 업데이트/배포 파이프라인
