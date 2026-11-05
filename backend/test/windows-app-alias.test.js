const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isWindowsAppAlias } = require("../src/services/windowsAppAlias");

/*
 * A Windows Store app alias - `python3.exe` under `%LOCALAPPDATA%\Microsoft\WindowsApps` - runs, but
 * once Node has spawned one, the next spawn of any *other* program aborts the whole Node process
 * with "AssignProcessToJobObject: (87) The parameter is incorrect." Both Python searches spawned
 * `python3` first, so a Windows machine with the alias lost its backend at boot. The helper answers
 * from PATH alone, without spawning, and never says yes off Windows.
 */
const APPS = "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps";
const REAL = "C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python314";
const env = { PATH: `${REAL};${APPS};C:\\Windows\\system32`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
const files = new Set([`${APPS}\\python3.exe`, `${APPS}\\python.exe`, `${REAL}\\python.exe`]);
// Case-insensitive, as Windows is: PATHEXT says .EXE and the file is python3.exe.
const lower = new Set([...files].map((file) => file.toLowerCase()));
const exists = (file) => lower.has(file.toLowerCase());
const win = { platform: "win32", env, exists };

test("a command whose first match on PATH is in WindowsApps is an alias", () => {
  assert.equal(isWindowsAppAlias("python3", win), true);
});

test("the first match decides: a real install earlier on PATH is not an alias", () => {
  assert.equal(isWindowsAppAlias("python", win), false);
});

test("a command found nowhere, or an explicit path outside WindowsApps, is not an alias", () => {
  assert.equal(isWindowsAppAlias("py", win), false);
  assert.equal(isWindowsAppAlias(`${REAL}\\python.exe`, win), false);
  assert.equal(isWindowsAppAlias("/usr/bin/python3", win), false);
});

test("an explicit path inside WindowsApps is an alias", () => {
  assert.equal(isWindowsAppAlias(`${APPS}\\python3.exe`, win), true);
});

test("off Windows the answer is always no, so Linux and macOS are untouched", () => {
  assert.equal(isWindowsAppAlias("python3", { ...win, platform: "linux" }), false);
  assert.equal(isWindowsAppAlias("python3", { ...win, platform: "darwin" }), false);
});

test("both Python searches skip an alias before spawning it", () => {
  for (const file of ["src/modules/sales/call-transcripts/transcriber.js", "src/modules/ai-feature/face-engine/engine.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.match(source, /if \(isWindowsAppAlias\(candidate\)\) continue;/, `${file} spawns a Store alias`);
  }
});
