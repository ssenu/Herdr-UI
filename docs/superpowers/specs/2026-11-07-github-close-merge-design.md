# GitHub 패널: 이슈 닫기와 PR 머지 — 설계

- 날짜: 2026-11-07
- 대상: `mods/my-github/main.js`, `mods/my-github/logic.js`, `tests/my-github-logic.test.mjs`, `README.md`
- 범위: 상세 화면에서 열린 이슈를 닫고, 열린 PR을 머지한다. PR 닫기, 다시 열기, 브랜치 삭제, `--admin` 우회, 자동 머지(`--auto`)는 하지 않는다.

## 확인한 것

- 이 PC의 `gh` 2.96.0. `gh pr merge`는 `--merge`, `--squash`, `--rebase`를 받는다. 방식을 주면 묻지 않고 실행한다.
- 지금의 `gh()` 도우미는 출력을 JSON으로 읽는다. `gh issue close`와 `gh pr merge`는 JSON을 내지 않으므로, 종료 코드만 보는 실행 함수가 따로 필요하다.
- 상세 화면의 읽기 필드에 `isDraft`가 없다. `gh issue view`는 `isDraft`를 받지 않으므로 PR에만 더한다.

## 버튼

상세 화면의 도구 줄(`브라우저로 열기`, 에이전트 버튼) 아래에 동작 줄을 하나 더 둔다. 버튼을 보이는 조건은 상세 데이터를 읽은 뒤 `state === "OPEN"`이고, PR이면 `isDraft`가 아닐 때다. 그 밖에는 이 줄이 없다.

단계:

| 단계 | 이슈 | PR |
|---|---|---|
| 처음 | `[이슈 닫기]` | `[머지]` |
| 고르기 | — | `[Merge] [Squash] [Rebase] [취소]` |
| 확인 | `이슈 #12를 닫을까요? [닫기] [취소]` | `PR #7을 Squash로 머지할까요? [머지] [취소]` |
| 실행 중 | `닫는 중…` | `머지 중…` |
| 실패 | `⚠ <gh가 말한 이유> [다시 시도] [취소]` | 같음 |

- `[다시 시도]`는 같은 명령을 다시 실행한다. `[취소]`는 처음 단계로 돌아간다.
- 확인 단계에 있는 동안 다른 항목을 열거나 뒤로 가면 단계가 사라진다.
- 실행이 끝나기 전에 다른 항목으로 가도 명령은 끝까지 돈다. 결과는 처음 항목의 상세 화면에만 반영된다.

## 실행

- 이슈: `gh issue close <번호>`.
- PR: `gh pr merge <번호> --merge | --squash | --rebase`. `--delete-branch`, `--admin`, `--auto`는 붙이지 않는다.
- 패널이 보는 곳(`cwd`, 원격이면 `on`)에서 실행한다. 목록과 같다.
- 성공하면 상세 화면을 다시 읽고(상태가 `CLOSED`/`MERGED`가 되어 동작 줄이 사라진다) 목록을 새로 읽는다.
- 실패 이유는 `ghError`로 만든다. `gh`가 시작하지 못하면 "이 머신에 gh가 없어요", 로그인 문제면 로그인 안내, 그 밖에는 `gh`가 출력한 첫 줄이다(권한 부족, 충돌, 필수 리뷰나 체크 미통과, 브랜치 보호 등).

## 함수 (`mods/my-github/logic.js`, 순수)

- `viewArgs(kind, number)`: PR이면 필드에 `isDraft`를 더한다.
- `canAct(kind, data)` → `data?.state === "OPEN" && !(kind === "pr" && data.isDraft)`.
- `actionArgs(kind, number, method)` → 이슈 `["issue", "close", "12"]`, PR `["pr", "merge", "7", "--squash"]`. `method`는 `"merge" | "squash" | "rebase"`, 그 밖이면 예외.
- `confirmText(kind, number, method)` → `이슈 #12를 닫을까요?` / `PR #7을 Squash로 머지할까요?`.

## 테스트

`tests/my-github-logic.test.mjs`에 추가: `viewArgs`(이슈·PR), `canAct`(열림, 닫힘, 머지됨, 초안 PR, 데이터 없음), `actionArgs`(세 방식, 잘못된 방식), `confirmText`. 화면 동작과 실제 닫기·머지는 사용자가 확인한다(실제 저장소의 상태를 바꾸므로 자동 시험하지 않는다).

## 문서

README의 GitHub 패널 절에 한 항목: 상세 화면에서 열린 이슈는 **[이슈 닫기]**, 열린 PR은 **[머지]** 후 Merge / Squash / Rebase를 골라 확인하면 실행된다. 브랜치는 지우지 않는다. 초안 PR에는 버튼이 없다.
