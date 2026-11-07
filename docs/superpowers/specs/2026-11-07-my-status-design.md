# 시스템 모니터 (하단 바 + 대시보드) — 설계

- 날짜: 2026-11-07
- 대상: 새 mod `mods/my-status`, `mods/my-status-dash`, `install.ps1`, `README.md`, `package.json`, `tests/`
- 범위: 이 PC의 CPU·RAM·GPU 표시와 최근 5분 그래프. Windows만. 원격 머신 수치, 디스크·네트워크, 기록 저장은 하지 않는다.

## 구성

- `my-status`: 기본 `workspace-status`의 복제본(`cloned_from` 기록). 왼쪽 표시와 오른쪽 끝 `commands` 안내는 그대로 두고, 안내 바로 왼쪽에 수치를 넣는다. 값을 읽고 기록을 쌓는다.
- `my-status-dash`: 대시보드 오버레이. 값을 읽지 않고 받은 기록만 그린다.
- `install.ps1`: 레이아웃에서 `status` 칸의 mod가 `workspace-status`이면 `my-status`로 바꾼다(멱등, 기존 백업 사용).

## 하단 바

`CPU 13%  RAM 19.7/31.4GB  GPU 8%`

- 원격 스페이스에서는 앞에 `이 PC`.
- 사용률 90% 이상인 항목은 `t.blocked`, 나머지는 하단 바 글자색. RAM 사용률은 사용량/전체.
- 처음 읽기 전에는 수치 자리를 비운다. GPU 값이 없으면 GPU 항목만 뺀다.
- Windows가 아니면(`window()?.platform !== "windows"`) 읽지 않고 표시하지 않는다.

## 읽기

- 5초마다 `exec("powershell", ["-NoProfile", "-Command", script])` 한 번. 이전 읽기가 안 끝났으면 건너뛴다.
- 스크립트: `Win32_PerfFormattedData_PerfOS_Processor`(`_Total`), `Win32_OperatingSystem`, `Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine`. 항목마다 따로 `try`로 묶어, 하나가 실패해도 나머지는 나온다.
- 출력 한 줄: `METRICS<TAB>cpu<TAB>ramUsedKb<TAB>ramTotalKb<TAB>gpu`. 못 읽은 값은 빈 칸.
- GPU 값: 엔진 종류별 `UtilizationPercentage` 합계 중 최댓값, 100 초과는 100.
- 실패: 명령 실패이거나 CPU·RAM을 모두 못 읽으면 실패로 센다. 3번 연속 실패까지는 이전 값 유지, 그 뒤 수치를 숨기고 기록에도 빈 칸을 넣는다. 성공하면 다시 표시.
- 비용(이 PC 측정): 한 번에 CPU 시간 약 0.33초, 5초 간격이면 16스레드 전체의 약 0.4%. `WmiPrvSE` 부담은 측정에 포함되지 않았다.

## 대시보드

- 수치 위에 0.3초 머물면 `openOverlay({ mod: "my-status-dash", kind: "window", frame: "none", width: 300, height, at: { x, y }, props })`로 수치 바로 위에 연다. 벗어나면 닫는다. 0.3초 안에 벗어나면 열지 않는다.
- 위치: 하단 바 측정값으로 바 오른쪽 끝에 맞추고, 왼쪽·위로 창 밖에 나가지 않게 제한. (mod는 창 크기를 알 수 없고, 크기 측정은 루트에서만 확실하다.)
- 내용: 제목 `시스템 · 이 PC`, CPU·RAM·GPU별 현재 값과 막대그래프(60칸), 바닥에 `최근 5분`. GPU를 못 읽으면 GPU 칸을 뺀다. 버튼 없음.
- 막대: 고정 폭 `div` 나열. 90% 이상은 `t.blocked`, 빈 칸(값 없음)은 막대 없음.
- 기록: `my-status`의 메모리에 항목별 최근 60개. 앱을 끄면 사라진다.
- 데이터 전달: `my-status`가 그릴 행(`dashRows`)을 계산해, 열 때 props로 주고 열려 있는 동안만 `setShared("my-status.dash", rows)`로 갱신한다. 닫으면 `null`로 비운다(공유 값 변경은 모든 mod를 다시 그리므로 평소에는 보내지 않는다).
- 첫 구현 단계에서 호버 열기·닫기를 시험한다. 오버레이가 포인터를 가로채 깜빡이는 등 안 되면 수치를 클릭해 열고 닫는 방식으로 바꾼다.

## 함수 (`mods/my-status/logic.js`, 순수)

- `metricsCommand()` → `{ command, args }`.
- `parseMetrics(stdout)` → `{ cpu, ramUsed, ramTotal, gpu }`(GB 변환, 범위 제한) 또는 `null`.
- `pushHistory(history, sample, limit = 60)`: 항목별로 뒤에 더하고 오래된 값을 버린다.
- `failStep(state, ok)`: 연속 실패 횟수와 숨김 여부.
- `summaryParts(metrics, remote)`: 하단 바 항목 목록(`{ label, value, hot }`), `isHot(percent)`.
- `barHeights(values, height)`: 값 → 막대 높이(값이 있으면 최소 1px, 없으면 0).
- `dashRows(metrics, history, barHeight)`, `dashHeight(rowCount)`: 대시보드가 그릴 행과 높이.
- `dashAnchor(bounds, size)`: 대시보드 위치.

`my-status-dash`는 받은 행만 그리므로 로직을 불러오지 않는다.

## 테스트

`tests/my-status-logic.test.mjs` (`npm test`에 추가):

- `parseMetrics`: 정상, CRLF, GPU 빈 칸, CPU만, 전부 빈 칸, 깨진 줄, 범위 밖 값.
- `pushHistory`: 60개 제한, 빈 값, 입력을 고치지 않음. `failStep`: 1·2·3번 실패, 복구.
- `summaryParts`: 원격 라벨, GPU 없음, 90% 경계. `barHeights`: 0·100·빈 값. `dashAnchor`: 창 밖으로 안 나감.
- 실제 PowerShell 실행(Windows에서만): CPU·RAM이 범위 안의 숫자로 나옴.

배치, 호버 동작, 작업 관리자와의 값 비교는 사용자가 확인한다.

## 문서

README: mod 표, 기능 절(`시스템 모니터`), 설치 mod 수, 수동 설치·제거. 알려진 한계:

- Windows에서만 표시. 항상 이 PC의 값이며 원격 머신 값이 아니다.
- 그래프는 앱을 켠 뒤부터 쌓이고 앱을 끄면 사라진다.
- 5초마다 PowerShell을 한 번 실행한다.
- `my-status`는 기본 mod의 복제본이라 Herdr 업데이트를 자동으로 따라가지 않는다.
