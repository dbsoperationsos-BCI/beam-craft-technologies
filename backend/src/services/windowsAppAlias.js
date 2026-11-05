const fs = require("node:fs");
const path = require("node:path");

/*
 * Whether a command would run a Windows Store app alias - the `python3.exe` stub under
 * `%LOCALAPPDATA%\Microsoft\WindowsApps` that the Python install manager and the Store register.
 *
 * Such an alias runs, and answers `--version` correctly, but once Node has spawned one, the next
 * spawn of any other program aborts the whole Node process with "AssignProcessToJobObject: (87) The
 * parameter is incorrect." - no exception to catch, just exit 3. An interpreter search that tries
 * `python3` first therefore took the backend down at boot on a Windows machine with the alias.
 *
 * Answered from PATH alone, the way Windows resolves a bare name (first directory that holds the
 * name with one of PATHEXT's extensions), so asking never spawns anything. Off Windows the answer is
 * always false, which leaves Linux and macOS exactly as they were.
 *
 * `lstat`, not `existsSync`: an alias is a reparse point that `stat` tries to follow and fails on,
 * so `existsSync` reports the alias as missing while Windows happily runs it.
 */
const entryExists = (file) => { try { fs.lstatSync(file); return true; } catch { return false; } };

function isWindowsAppAlias(command, { platform = process.platform, env = process.env, exists = entryExists } = {}) {
  if (platform !== "win32") return false;
  const name = String(command || "").trim();
  if (!name) return false;
  const inAliasFolder = (directory) => /[\\/]WindowsApps$/i.test(directory.replace(/[\\/]+$/, ""));
  // An explicit path: only a Windows path can be one, and its folder decides.
  if (/[\\/]/.test(name)) return /^[A-Za-z]:|^\\\\/.test(name) && inAliasFolder(path.win32.dirname(name));
  const extensions = path.win32.extname(name) ? [""] : String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const directories = String(env.PATH || env.Path || "").split(";").filter(Boolean);
  for (const directory of directories) {
    for (const extension of extensions) {
      if (exists(path.win32.join(directory, name + extension))) return inAliasFolder(directory);
    }
  }
  return false;
}

module.exports = { isWindowsAppAlias };
