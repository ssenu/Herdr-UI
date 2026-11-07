# 탭을 끌어 분할하기 — 설계

- 날짜: 2026-11-07
- 대상: 새 mod `mods/my-tab-drag`, `mods/my-tabs`, `mods/my-viewer`, `install.ps1`, `README.md`, `package.json`, `tests/`
- 범위: 한 칸짜리 터미널·에이전트 탭과 파일을 연 뷰어 탭을, 지금 보고 있는 탭의 네 방향으로 옮긴다. 여러 칸 탭, 원격 탭, 분할을 다시 탭으로 빼기, 크기 조절은 하지 않는다.

## 확인한 동작

임시 스페이스에서 시험했다.

- `terminal.park {terminal}` 후 `terminal.keep {terminal, place: "right" | "down"}`: 같은 프로세스가 포커스된 칸 옆으로 옮겨간다. 칸이 없어진 원래 탭은 자동으로 사라진다.
- `pane.swap {direction}`은 명령이 성공했다. 왼쪽·위 배치의 실제 결과는 화면에서 확인해야 한다.
- `pane.split {direction, pane?, mod, props}`: 칸 옆에 mod를 연다(문서).

## 끌기 (`my-tabs`)

- 탭을 누른 채 포인터가 탭 바를 벗어나면 `my-tab-drag` 오버레이를 연다(`kind: "window"`, `frame: "none"`, 창 전체). `my-files`의 드래그와 같은 방식.
- 탭 바 안에서 놓으면 지금처럼 순서를 바꾸거나 탭을 고른다.
- 오버레이 props: `{ tab: { id, name }, move, bar, overlay }`. `move`는 `tabMove`의 결과.

## 옮길 수 있는 탭 (`tabMove`)

| 탭 | 결과 |
|---|---|
| 지금 보고 있는 탭 | `{ blocked: "지금 보고 있는 탭은 옮길 수 없어요" }` |
| 칸이 둘 이상 | `{ blocked: "여러 칸으로 나뉜 탭은 옮길 수 없어요" }` |
| 원격(주소에 `/`) 터미널, 원격 스페이스 | `{ blocked: "원격 탭은 옮길 수 없어요" }` |
| 터미널 한 칸 | `{ kind: "terminal", terminal }` |
| 파일을 연 `my-viewer` 칸 | `{ kind: "viewer", path, on }` |
| 파일을 안 고른 `my-viewer`, 다른 mod 칸 | `{ blocked: "이 탭은 옮길 수 없어요" }` |

뷰어의 경로는 공유 값 `my-viewer.own`에서 탭 ID로 찾는다.

## 놓는 구역 (`my-tab-drag`)

- 작업 화면: 왼쪽 위는 탭 바의 왼쪽 아래 + 여백 8. 오른쪽 끝은 창 폭에서 여백 8과, 패널이 열려 있으면 패널 폭(`layout()`의 `panel.size.px`) + 간격 8을 뺀 곳. 아래 끝은 창 높이에서 하단 바 높이(`status.size.px`)와 여백 8을 뺀 곳. 창 크기는 오버레이 루트의 `on_size_change`로 잰다.
- 구역: 네 가장자리에서 안쪽으로 폭·높이의 25%. 모서리처럼 겹치면 가까운 가장자리. 가운데와 작업 화면 밖은 취소.
- 구역에 들어가면 분할될 절반 자리를 반투명하게 표시한다. 이름표: `놓으면 오른쪽으로 분할`(왼쪽·위쪽·아래쪽 같음), 구역 밖 `놓으면 취소`, 막힌 탭은 막힌 이유.
- Esc는 취소(오버레이가 키를 받을 수 있을 때).

## 옮기기

- 터미널: `terminal.park` → `terminal.keep { place }` → (왼쪽·위면) `pane.swap`.
  - right → place right. down → place down. left → place right + swap left. up → place down + swap up.
  - `terminal.keep`은 비동기로 끝날 수 있어, `spaces()`/`panes()`에 터미널이 새 칸으로 나타난 뒤 swap한다(최대 2초, 못 보면 그대로 두고 알림).
- 뷰어: 초안을 보관하도록 `tab.close`로 먼저 닫고 `pane.split { direction, mod: "my-viewer", props: { path, on } }` → (왼쪽·위면) `pane.swap`. 뷰어의 `close()`가 마지막 초안을 쓰므로 저장 안 한 내용은 새 칸에서 복원된다.
- 실패하면 `notify`로 이유를 알린다.
- 분할되는 칸은 포커스된 칸이다. 이미 나뉜 화면에서는 화면 전체가 아니라 그 칸이 나뉜다.

## 뷰어 변경 (`my-viewer`)

- `token`이 없는 칸은 탭을 찾지 않고 이름도 바꾸지 않는다(이미 그렇게 동작하는지 확인). `●`는 칸 안의 "저장 안 됨" 표시로만 보인다.
- `my-viewer.own` 값에 `on`을 더한다.
- 분할 칸의 뷰어는 `my-viewer.open`에 등록되지 않으므로, 같은 파일을 다시 드롭하면 새 탭이 열린다. 한계로 적는다.

## 함수 (`mods/my-tab-drag/logic.js`, 순수)

- `tabMove(tab, { activeTab, panes, spaceMachine, own })` → 위 표.
- `workArea({ bar, window, panelWidth, statusHeight })` → `{ x, y, width, height }`.
- `dropZone(position, area)` → `"left" | "right" | "up" | "down" | null`.
- `previewBox(zone, area)` → 표시할 절반 영역.
- `placement(zone)` → `{ place, split, swap }`.
- `dropLabel(zone, move)` → 이름표 글.

`my-tabs`는 `tabMove`가 필요하므로 `logic.js`를 복사본으로 두고(`mods/my-tabs/tab-move.js`), 테스트로 내용이 같은지 확인한다.

## 테스트

`tests/my-tab-drag-logic.test.mjs` (`npm test`에 추가): `tabMove` 표의 모든 줄, `workArea`(패널 있음·없음), `dropZone`(네 구역, 모서리, 가운데, 밖, 경계), `previewBox`, `placement`, `dropLabel`, 복사본 일치. 화면 동작은 사용자가 확인한다.

## 문서

README: mod 표, 기능 절(`탭을 끌어 분할하기`), 설치 mod 수, 제거. 알려진 한계:

- 한 칸짜리 터미널·에이전트 탭과 파일을 연 뷰어 탭만 옮긴다. 원격 탭은 옮기지 않는다.
- 이미 나뉜 화면에서는 포커스된 칸이 나뉜다.
- 분할 칸의 뷰어는 탭 이름에 `●`가 없고, 이미 열린 파일로 이동하지 않는다.
- 분할을 다시 탭으로 빼는 기능은 없다.
