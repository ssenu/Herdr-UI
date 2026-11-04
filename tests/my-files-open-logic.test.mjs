import test from "node:test";
import assert from "node:assert/strict";
// Tests the repository copy of the mod (mods/ next to tests/).
const L = await import(new URL("../mods/my-files-open/logic.js", import.meta.url).href);

const WIN = "C:\\Users\\me\\바탕 화면\\a&b.txt";

const CODE = "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe";

test("openCommand on Windows", () => {
  assert.deepEqual(L.openCommand("default", WIN, "windows"), { command: "explorer.exe", args: [WIN], ignoreCode: true });
  // Code.exe, never code.cmd: a .cmd runs through cmd.exe, where "&" in a path would run a command.
  // Started through Start-Process so the call returns at once (exec waits for the program to exit).
  assert.deepEqual(L.openCommand("code", WIN, "windows", { codeExe: CODE }), {
    command: "powershell.exe",
    args: ["-NoProfile", "-Command", `Start-Process -FilePath '${CODE}' -ArgumentList '"${WIN}"'`],
    ignoreCode: false,
  });
  assert.equal(L.psQuote("it's"), "'it''s'");
  assert.equal(L.openCommand("code", WIN, "windows"), null);
  assert.deepEqual(L.openCommand("reveal", WIN, "windows"), { command: "explorer.exe", args: ["/select," + WIN], ignoreCode: true });
});

test("codeExeFrom: Code.exe beside the bin folder of code.cmd", () => {
  assert.equal(L.codeExeFrom("C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd\r\n"), CODE);
  assert.equal(L.codeExeFrom("C:\\A\\bin\\code.cmd\r\nD:\\B\\bin\\code.cmd\r\n"), "C:\\A\\Code.exe");
  assert.equal(L.codeExeFrom(""), null);
  assert.equal(L.codeExeFrom("C:\\weird\\code.cmd"), null);
});

test("openCommand on macOS and Linux", () => {
  assert.deepEqual(L.openCommand("default", "/u/a b.md", "macos"), { command: "open", args: ["/u/a b.md"], ignoreCode: false });
  assert.deepEqual(L.openCommand("reveal", "/u/a b.md", "macos"), { command: "open", args: ["-R", "/u/a b.md"], ignoreCode: false });
  assert.deepEqual(L.openCommand("code", "/u/a b.md", "macos"), { command: "code", args: ["/u/a b.md"], ignoreCode: false });
  assert.deepEqual(L.openCommand("default", "/u/a.md", "linux"), { command: "xdg-open", args: ["/u/a.md"], ignoreCode: false });
  assert.deepEqual(L.openCommand("reveal", "/u/docs/a.md", "linux"), { command: "xdg-open", args: ["/u/docs"], ignoreCode: false });
  assert.deepEqual(L.openCommand("reveal", "a.md", "linux"), { command: "xdg-open", args: ["."], ignoreCode: false });
});

test("openCommand: unknown action is null", () => {
  assert.equal(L.openCommand("copy", WIN, "windows"), null);
});

test("ITEMS: labels and actions in menu order", () => {
  assert.deepEqual(L.ITEMS.map(i => i.action), ["default", "code", "reveal", "copy"]);
  assert.deepEqual(L.ITEMS.map(i => i.label), ["기본 프로그램으로 열기", "VS Code로 열기", "탐색기에서 보기", "경로 복사"]);
});
