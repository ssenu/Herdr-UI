import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// mods can't import outside their own folder, so ui.js is copied; every copy must match the original.
const file = p => new URL(`../mods/${p}`, import.meta.url);

test("every ui.js copy matches mods/my-files/ui.js", () => {
  const original = readFileSync(file("my-files/ui.js"), "utf8");
  for (const mod of ["my-viewer", "my-github", "my-plugins", "my-sessions", "my-tasks"]) {
    assert.equal(readFileSync(file(`${mod}/ui.js`), "utf8"), original, `${mod}/ui.js differs`);
  }
});
