# my-files: Files 패널 편집 + 드래그로 경로 넣기 — 설계

- 날짜: 2026-11-03
- 대상: herdr 앱 설정 `~/.config/herdr-app` (Windows: `%USERPROFILE%\.config\herdr-app`)
- 참고 코드: `herdr-files-drag-path (작성자의 이전 코드)` (드래그 기능의 출처)

## 목표

1. Files 패널에서 로컬 파일을 바로 편집하고 Ctrl+S로 저장한다.
2. Files 목록의 파일/폴더를 패널 밖으로 끌어 터미널 위에서 놓으면, 포커스된 터미널 프롬프트에 그 절대경로가 입력된다.

## 범위 밖

- 원격 스페이스 파일의 패널 내 편집 (`writeTextFile`이 로컬 전용). 원격은 nano로 연다.
- 메모리 내용과 디스크 내용의 diff 화면.
- 놓은 위치의 칸을 대상으로 붙여넣기 (`panes()`가 칸의 화면 좌표를 주지 않음).
- 상대경로, `@경로` 형식.
- 저장하지 않은 내용의 앱 재시작 후 복원.

## 1. 구성

| 대상 | 내용 |
|---|---|
| `mods/my-files` | `herdr-app do mod.clone '{"name":"files","as":"my-files"}'`로 복제(`cloned_from` 기록). 드래그 기능 + 편집 기능 추가. 아이콘 경로는 `mods/my-files/...`로 수정. |
| `mods/my-files-drag` | 참고 코드 `mods/files-drag-path-layer`를 가져와 이름 변경. 클립보드 쓰기를 `cx.write_to_clipboard`로 교체. `mod.json`: `{ "place": "none" }`. |
| `layouts/my-layout.json` | Files 칸(id `files`)의 `"mod": "files"` → `"mod": "my-files"`. 칸 id는 `files` 유지. |

- 탭 바는 수정하지 않는다. `mods/tabs/main.js:97`이 칸 id `"files"`로 버튼을 판단하므로 그대로 동작한다.
- 참고 코드의 `files-drag-path`, `files-drag-path-layer` mod는 설치하지 않는다.
- 기본 `files` mod는 수정하지 않는다.

## 2. 드래그로 경로 넣기

동작은 참고 코드와 같다.

- 행에서 `on_mouse_down("left")` 시 `this.drag = { path: 절대경로, name, dir }`를 기록한다.
- 패널 루트에서:
  - `on_mouse_up("left")`: `this.drag = null` (패널 안 클릭은 드래그가 아님).
  - `on_mouse_move`: 패널 좌상단의 창 좌표(`position - local_position`)를 기록한다.
  - `on_size_change`: 패널 크기를 기록한다.
  - `on_hover(false)`이고 `this.drag`가 있으면 `openOverlay({ mod: "my-files-drag", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { ...drag, panel } })`로 투명 창을 연다.
- `my-files-drag`:
  - 커서를 따라다니는 이름표("📁/📄 이름 · 놓으면 경로 입력")를 그린다.
  - `on_mouse_up`: 놓은 위치가 패널 상자 안이면 취소, 아니면 붙여넣기. 그 후 overlay를 닫는다.
  - `on_mouse_down`: 창이 열리기 전에 이미 마우스를 뗀 경우, 다음 클릭에서 그냥 닫는다.
- 절대경로: `root` 끝의 구분자를 지우고 `/상대경로`를 붙인다. 로컬 Windows면 `/`를 `\`로 바꾼다. 원격이면 원격 경로를 그대로 쓴다.
- 입력 문자열: 경로에 `[\s'"&()^%!,;=]` 문자가 있으면 `"경로"`로 감싸고, 끝에 공백 하나를 붙인다. Enter는 보내지 않는다.
- 붙여넣기: `cx.write_to_clipboard(text)` 후 `run("terminal.paste", {})`. 동기 처리라 비동기 작업이 없다. Windows에서만 켜지게 막는 조건(`platform !== "windows"`)은 제거한다.
- 알려진 한계: 놓은 칸이 아니라 마지막으로 포커스된 터미널에 들어간다. 클립보드 내용이 경로로 바뀐다.

## 3. 편집

### 편집 가능 조건

다음을 모두 만족하면 `EditorState`를 `readonly: false`로 만든다.

- 로컬 스페이스 (`this.on`이 null)
- 잘리지 않음 (텍스트 길이 ≤ 400,000자. 이보다 길면 지금처럼 잘라서 보여 주므로 편집 불가)
- 텍스트 파일 (`\0` 없음, `readTextFile` 결과가 null 아님)

조건을 벗어나면 읽기 전용으로 두고, 헤더에 이유("원격 파일 · 읽기 전용" / "큰 파일 · 일부만 표시")와 **[nano로 열기]** 버튼을 보여 준다. `readTextFile`은 1 MiB까지만 읽으므로, 그보다 큰 파일은 지금처럼 미리보기 오류가 난다. 이 경우에도 [nano로 열기] 버튼을 보여 준다.

### 버퍼

스페이스(`context.key`)마다 다음 상태를 둔다.

```
buffers: Map<path, { state: EditorState, base: string, dirty: boolean, conflict: boolean }>
```

- `base`: 마지막으로 읽었거나 저장한 디스크 내용.
- `dirty`: 편집기 `change` 이벤트마다 `state.value() !== base`로 계산한다.
- 파일을 열 때 버퍼가 있으면 그 버퍼를 다시 쓴다(디스크를 새로 읽지 않음). 없으면 새로 읽어 만든다.
- 다른 파일로 가거나 ←를 누르면, `dirty`가 아닌 버퍼만 `release()`하고 지운다. `dirty`인 버퍼는 남긴다.
- 스페이스를 전환할 때 기존 `this.saved`에 `{ folders, file, buffers }`를 함께 저장하고, 돌아오면 복원한다.
- 앱을 끄면 사라진다.

### 저장

- 편집 화면에서 `on_key_down`으로 Ctrl+S(`event.keystroke === "ctrl-s"`, macOS면 `"cmd-s"`)를 받는다. 편집 불가 파일에서는 무시한다.
- `writeTextFile(절대경로, state.value(), base)`를 호출한다.
  - 성공: `base = value`, `dirty = false`, `conflict = false`.
  - 오래된 내용이라 거부됨: `conflict = true`.
  - 그 밖의 오류: `notify({ title: "저장하지 못했어요", body: 경로, level: "error" })`. 버퍼 상태는 유지.
- 거부와 다른 오류를 구분하는 방법(오류 메시지 형식)은 구현할 때 확인한다. 구분할 수 없으면 실패 후 디스크를 다시 읽어 `base`와 다르면 충돌로, 같으면 일반 오류로 처리한다.

### 디스크 변경 감지 · 충돌

- 기존 `watchFolder` 루프가 변경을 알리면, 현재 스페이스의 모든 버퍼에 대해 디스크를 다시 읽는다.
  - 디스크 내용 == `base`: 할 일 없음.
  - `dirty`가 아님: `state.set_value(disk)`, `base = disk`. 화면이 조용히 새로고침된다.
  - `dirty`임: `conflict = true`.
  - 파일이 사라짐(null): `dirty`가 아니면 버퍼를 지운다. `dirty`이면 `conflict = true`.
- 충돌 상태면 헤더에 "디스크의 파일이 바뀌었어요" 알림과 버튼 두 개를 보여 준다.
  - **[내 것으로 덮어쓰기]**: 디스크를 다시 읽어 `base`로 삼고(사라졌으면 `null`), `writeTextFile(경로, value, base)`로 저장한다.
  - **[디스크 버전 불러오기]**: 디스크를 다시 읽어 `set_value(disk)`, `base = disk`, `dirty = false`, `conflict = false`.

### 표시

- `dirty`인 파일은 목록의 파일명과 헤더의 파일명 옆에 ● 점을 붙인다.
- 편집 가능 여부는 헤더로 구분한다(읽기 전용이면 이유를 보여 줌).

### nano로 열기

- 칸을 오른쪽으로 나누고 `nano <절대경로>`를 실행한다. 원격 스페이스면 그 머신에서 실행된다. 작업 폴더는 파일이 있는 폴더로 한다.
- 실제 명령(`terminal.open {argv: ["nano", 경로], folder, place: "right"}` 또는 `pane.split` 조합)과, 원격 스페이스에서 그 머신에 터미널이 열리는지는 구현할 때 `AGENTS.md`로 확인한다.
- 로컬 Windows에서는 Git for Windows의 `nano.exe`(PATH에 있음)를 쓴다.

## 4. 오류 처리

- 저장 실패(거부 외): 오류 알림, 버퍼 유지.
- 드래그 붙여넣기 실패(예외): 오류 알림 "경로를 붙여넣지 못했어요". overlay는 반드시 닫는다.
- 디스크 다시 읽기 실패: 해당 버퍼는 건드리지 않는다.

## 5. 검증 (직접 실행)

1. 로컬 파일을 고치면 ●가 붙고, Ctrl+S로 저장하면 ●가 사라지며 디스크에 반영된다.
2. 고친 채 다른 파일로 갔다 돌아오면 고친 내용이 남아 있다. 스페이스를 바꿨다 돌아와도 남아 있다.
3. 고친 내용이 없는 파일을 바깥에서 바꾸면 화면이 자동으로 새로고침된다.
4. 고친 상태에서 바깥(에이전트 등)이 같은 파일을 바꾸면 충돌 알림이 뜬다. 덮어쓰기와 불러오기가 각각 기대대로 동작한다.
5. 원격 파일과 400,000자를 넘는 파일은 읽기 전용으로 뜨고, [nano로 열기]가 옆 칸에 nano를 띄운다.
6. 파일을 끌어 터미널 위에서 놓으면 절대경로(공백이 있으면 따옴표 + 끝 공백)가 입력된다. 패널 위에서 놓으면 아무 일도 없다.
7. 기본 `files` mod와 탭 바의 Files 버튼이 계속 정상 동작한다.
