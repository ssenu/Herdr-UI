// Pure helpers for my-files-open. No herdr or gpui imports, so `node --test` can load this file.

/** The menu, in order. "copy" is handled in main.js (clipboard), the rest by openCommand. */
export const ITEMS = [
  { action: "default", label: "기본 프로그램으로 열기" },
  { action: "code", label: "VS Code로 열기" },
  { action: "reveal", label: "탐색기에서 보기" },
  { action: "copy", label: "경로 복사" },
];

/** A PowerShell single-quoted string literal (only ' is special inside). */
export function psQuote(s) {
  return "'" + s.replaceAll("'", "''") + "'";
}

function parent(path) {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : ".";
}

/**
 * VS Code's Code.exe from `where code.cmd` output (first line: <install>\bin\code.cmd), or null.
 * Code.exe is run directly: a .cmd goes through cmd.exe, which would treat "&" in a path as a command.
 */
export function codeExeFrom(whereOutput) {
  const first = (whereOutput ?? "").split(/\r?\n/).map(s => s.trim()).find(Boolean);
  const m = first && /^(.*)[\\/]bin[\\/]code\.cmd$/i.exec(first);
  return m ? `${m[1]}\\Code.exe` : null;
}

/**
 * The program that opens `path` for an action, per window().platform; null when it can't.
 * ignoreCode: explorer.exe reports 1 even when it worked.
 */
export function openCommand(action, path, platform, { codeExe = null } = {}) {
  if (platform === "windows") {
    if (action === "default") return { command: "explorer.exe", args: [path], ignoreCode: true };
    // Start-Process returns at once; exec would otherwise wait (up to its limit) for VS Code to exit.
    if (action === "code") return codeExe ? {
      command: "powershell.exe",
      args: ["-NoProfile", "-Command", `Start-Process -FilePath ${psQuote(codeExe)} -ArgumentList ${psQuote(`"${path}"`)}`],
      ignoreCode: false,
    } : null;
    if (action === "reveal") return { command: "explorer.exe", args: ["/select," + path], ignoreCode: true };
    return null;
  }
  const mac = platform === "macos";
  if (action === "default") return { command: mac ? "open" : "xdg-open", args: [path], ignoreCode: false };
  if (action === "code") return { command: "code", args: [path], ignoreCode: false };
  if (action === "reveal") return mac
    ? { command: "open", args: ["-R", path], ignoreCode: false }
    : { command: "xdg-open", args: [parent(path)], ignoreCode: false };
  return null;
}
