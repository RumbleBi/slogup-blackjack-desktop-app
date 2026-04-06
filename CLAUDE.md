## What This Repo Is

- electron.js 를 기반으로 만든 블랙잭 게임
- supabase 를 사용해서 데이터 관리
- 현재 프로젝트의 목표는 코드 리팩토링

## Commands

- install: `npm install`
- dev: `npm run electron-vite dev`
- lint: `npm run eslint --cache .`
- format: `npm run prettier --write .`
- test: `npm test`
- build: `npm run typecheck && electron-vite build`
- release for mac: `npm run release:tag-push && npm run release:mac`
- release for windows: `npm run release:tag-push && npm run release:win`

## Current Project Refactoring Goal

- tailwindcss 를 사용해서 UI 를 개선
- shadcn/ui 를 사용해서 재사용 가능한 컴포넌트 구축
- tanstack-query 를 사용해서 데이터 관리
- FSD(feature sliced design) 를 사용해서 아키텍처 구조 개선

## Rules

- .env 파일은 절대 건드리지 말 것
- 바로 구현하지 말고, 조사 -> 계획 -> 실행 단계로 진행할 것
- 파일을 삭제하기 전에는 반드시 물어볼 것
- 테스트가 통과되지 않으면 완료했다고 말하지 말 것
