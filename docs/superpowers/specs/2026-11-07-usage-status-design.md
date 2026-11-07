# 하단 바 사용량 요약 — 설계

- 날짜: 2026-11-07
- 대상: `mods/my-status`, 새 mod `mods/my-usage-dash`, `install.ps1`, `README.md`, `package.json`, `tests/`
- 범위: `ccusage` 요약을 시스템 수치 왼쪽에 표시하고, 마우스를 올리면 작은 대시보드를 띄운다. 원격 서버의 사용량, 한도 경고, 설정 화면은 하지 않는다.

## 확인한 동작

- `npx -y ccusage@latest daily --json --since <YYYYMMDD>`: 일별 `period`, `totalCost`, `modelBreakdowns[].{modelName, cost}`와 `totals.totalCost`.
- `npx -y ccusage@latest blocks --active --json`: `blocks[0].{costUSD, startTime, endTime, projection.totalCost, projection.remainingMinutes, isActive}`.
- 패키지를 받아 둔 뒤 한 번 실행에 약 1.6초 걸렸다.
- Windows에서 `npx`를 바로 실행하면 ENOENT. `cmd /c npx ...`는 동작한다.
- mod의 `exec`는 30초 제한, 출력 8 MiB 제한이고, 시작하지 못하면 reject한다.

## 하단 바 (`my-status`)

```
오늘 $104 · 블록 $33 · 2h15m 남음   │ CPU 12%  RAM 48%  GPU 3%
```

- 시스템 수치의 왼쪽. 마우스 영역은 `status-usage`로 따로 둔다. 두 대시보드가 동시에 뜨지 않는다.
- 금액은 정수 달러로 반올림한다.
- 활성 블록이 없으면 `오늘 $104`만 보인다.
- 값을 한 번도 읽지 못했으면 영역 자체가 없다.

## 대시보드 (`my-usage-dash`)

마우스를 0.3초 올리면 뜨고, 벗어나면 닫힌다. 시스템 대시보드와 같은 방식(`kind: "window"`, `frame: "none"`, 공유 값으로 내용 갱신).

```
사용량 · 이 PC                  5분 전 갱신
현재 블록                 $33.08 → 예상 $95
████████░░░░░░░░░░░░░░       2h15m 남음
최근 7일
▂ ▅ ▃ ▇ ▁ ▄ █                     오늘 $104
오늘 모델별
Opus $90.59 · Sonnet $13.28 · Haiku $0.45
이번 달 $345               API 가격 기준 추정치
```

- 블록 막대: `startTime`에서 `endTime`까지 지난 시간의 비율.
- 최근 7일: 오늘 포함 7일, 기록 없는 날은 0. 가장 큰 날을 막대 최대 높이로 한다.
- 모델별: 비용 큰 순. 이름은 `claude-opus-5-5` → `Opus`처럼 줄이고, 줄일 수 없는 이름은 그대로 쓴다. 오늘 기록이 없으면 이 줄을 뺀다.
- 활성 블록이 없으면 블록 부분에 `활성 블록 없음`을 표시한다.

## 읽기

- 앱을 켤 때와 그 뒤 5분마다 `cmd /c npx -y ccusage@latest ...`로 두 명령을 차례로 실행한다. 읽는 중이면 그 회차는 건너뛴다.
- `--since`는 이번 달 1일과 6일 전 중 빠른 날(로컬 날짜). "오늘"도 로컬 날짜로 찾는다. `ccusage`도 기본으로 로컬 날짜로 묶는다.
- 이번 달 합계는 `period`가 이번 달인 줄의 합이다. `totals`는 앞달이 섞일 수 있어 쓰지 않는다.
- 남은 시간은 블록의 `endTime`으로 1분마다 다시 계산한다. `endTime`이 지나면 다음 읽기 전이라도 활성 블록이 없는 것으로 친다.
- 한쪽 명령만 실패하면 그쪽의 마지막 값을 유지한다. 대시보드의 갱신 시각은 두 명령이 모두 성공한 마지막 시각이다.
- 갱신 시각이 없으면 `갱신 전`, 1분 미만이면 `방금 갱신`, 그 외 `N분 전 갱신` / `N시간 전 갱신`.
- 시스템 수치 읽기와 독립적이다. 한쪽 실패가 다른 쪽을 숨기지 않는다.
- 기존 `my-status`처럼 Windows에서만 읽는다.

## 표시 범위

- 일별 값은 `ccusage`가 찾은 모든 CLI의 합이다. 블록은 Claude Code만 있다(`ccusage codex blocks`는 "only available for Claude Code usage"로 거절).
- 원격 스페이스에서도 이 PC의 기록을 보여 준다. 제목의 `이 PC`로 드러낸다.
- 금액은 API 가격으로 계산한 추정치이며 구독 요금과 다르다. 대시보드에 적는다.

## 함수 (`mods/my-status/usage.js`, 순수)

- `usageCommands(now)` → `{ daily: { command, args }, blocks: { command, args } }`.
- `parseDaily(stdout)` → `{ days: [{ day, cost, models: [{ name, cost }] }] }` 또는 null.
- `parseBlock(stdout)` → `{ cost, start, end, projected }`, 활성 블록이 없으면 `{ none: true }`, 해석 실패면 null. 날짜는 밀리초로 바꾼다.
- `usageSummary(usage, now)` → 바에 보일 글, 값이 없으면 null.
- `usageDash(usage, now, refreshed)` → 대시보드가 그릴 값.
- `shortModel(name)`, `leftText(ms)`, `ageText(ms)`, `money(n)`.

## 테스트

`tests/my-usage-logic.test.mjs` (`npm test`에 추가): 명령 인자, 해석(정상, 깨진 JSON, 빈 목록, 활성 블록 없음), `--since`의 달 경계, 요약(블록 있음·없음·끝남), 대시보드 값(7일 채우기, 달 합계, 모델 순서), 시간과 금액 글. 화면 동작은 사용자가 확인한다.

## 문서

README: mod 표, 기능 절, 설치 mod 수, 제거. 알려진 한계: Windows에서만 읽는다, 이 PC의 기록만 본다, Node.js가 필요하다, 금액은 추정치다, `@latest`라 실행할 때마다 npm을 확인하고 새 버전이 자동으로 실행되며 형식이 바뀌면 표시가 사라질 수 있다.
