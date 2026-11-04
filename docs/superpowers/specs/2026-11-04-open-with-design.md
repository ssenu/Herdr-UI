# Files 행의 "외부 프로그램으로 열기" 메뉴 — 설계

- 날짜: 2026-11-04
- 대상: `mods/my-files`, 새 mod `mods/my-files-open`, `install.ps1`, `README.md`

## 동작

- `my-files` 목록의 각 행 맨 오른쪽(git 표시 뒤)에 `⋯` 버튼. 평소 흐리게(`t.dim`), hover 시 밝게 + 배경. 원격 스페이스(`this.on`)에서는 숨김.
- 버튼의 mouse down/click은 전파를 막아 행의 드래그 시작·파일 열기·폴더 펼치기가 일어나지 않는다.
- 누르면 `openOverlay({ mod: "my-files-open", kind: "popup", width: 200, height: 136, props: { path: 절대경로, dir } })`.
- `my-files-open` 팝업 메뉴(Herdr `menu` mod와 같은 모양, ↑/↓/Enter/Esc):
  1. 기본 프로그램으로 열기 (`default`)
  2. VS Code로 열기 (`code`)
  3. 탐색기에서 보기 (`reveal`)
  4. 경로 복사 (`copy`) — `cx.write_to_clipboard(path)`, 따옴표 없음
- 항목을 고르면 팝업을 닫고 실행. 실패(예외, 또는 explorer가 아닌 명령의 0이 아닌 종료 코드)면 `notify({ title: "열지 못했어요", body, level: "error", timeout: 5000 })`.

## 명령 (`my-files-open/logic.js` → `openCommand(action, path, platform)`, 실행하는 mod 안에 둔다)

| action | windows | macos | linux |
|---|---|---|---|
| default | `["explorer.exe", [path]]` | `["open", [path]]` | `["xdg-open", [path]]` |
| code | `["code.cmd", [path]]` | `["code", [path]]` | `["code", [path]]` |
| reveal | `["explorer.exe", ["/select," + path]]` | `["open", ["-R", path]]` | `["xdg-open", [상위 폴더]]` |

- 반환 `{ command, args, ignoreCode }` — `ignoreCode`는 explorer일 때 true(성공해도 1을 돌려줌).
- 상위 폴더: 마지막 `/` 또는 `\` 앞. 없으면 `"."`.

## 범위 밖

- 원격 파일 열기, 프로그램 목록 설정, 파일 연결 고르기(“다른 프로그램으로 열기” 대화상자).

## 검증

- 자동: `openCommand` 단위 테스트, `herdr-app check` (my-files, my-files-open), 공백·`&`가 든 경로로 `explorer.exe`/`code.cmd` 실행 확인.
- 직접: 네 항목 동작, `⋯` 클릭 시 행 동작이 일어나지 않음, 원격 스페이스에서 버튼 없음.
