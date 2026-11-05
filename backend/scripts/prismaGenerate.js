#!/usr/bin/env node
/**
 * `npm run prisma:generate` - Prisma's generate, made safe to run while the backend is up.
 *
 * On Windows, `prisma generate` writes the query engine to `query_engine-windows.dll.node.tmp<pid>`
 * and renames it over the real file. A backend dev server (`npm run dev`: concurrently → nodemon →
 * src/server.js) has that DLL loaded, Windows refuses the rename, and the command fails with
 * `EPERM: operation not permitted, rename ...` - leaving the 21 MB temp copy behind, once per
 * attempt. Nothing about the schema or the client is wrong; the file is simply in use. Plain
 * `npx prisma generate` cannot do anything about that, which is why this script exists.
 *
 * Before generating, it asks Windows which processes have THIS backend's engine file loaded - by
 * its full path, so a server from another checkout, the frontend or the desktop app is never
 * matched - and stops each one together with the `npm run dev` it belongs to (walking up through
 * nodemon, the npm wrappers and concurrently, so the dev Redis stops with it and nothing is left
 * half-running). A second dev session forgotten in another terminal is found the same way. It
 * then waits until the file is actually free - Windows releases it a moment after the process
 * dies, and generating before then is what still failed - runs generate, sweeps the `.tmp*`
 * engine copies earlier failures left, and says the backend must be started again. It never
 * touches the database: generate reads the schema file only. On Linux and macOS a loaded file can
 * be replaced, so nothing is stopped there.
 */
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const backendDir = path.resolve(__dirname, "..");
const engineDir = path.join(backendDir, "node_modules", ".prisma", "client");
const enginePath = path.join(engineDir, "query_engine-windows.dll.node");
const RELEASE_WAIT_MS = 15000;

function powershell(script) {
  const out = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  return out.status === 0 ? out.stdout : "";
}

/** Pids of the processes that have this backend's engine file loaded. */
function engineHolders() {
  // Single quotes inside a PowerShell literal are doubled; the path is ours, but a folder may hold one.
  const literal = enginePath.replace(/'/g, "''");
  const script = `Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { try { $_.Modules.FileName -contains '${literal}' } catch { $false } } | ForEach-Object { $_.Id }`;
  return powershell(script).split(/\r?\n/).map(Number).filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);
}

/** Every node and cmd process, by pid: { parent, command }. */
function processTable() {
  // A tab between fields ([char]9): a PowerShell backtick escape would end this JavaScript string.
  const script = "Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='cmd.exe'\" | ForEach-Object { \"$($_.ProcessId)\" + [char]9 + \"$($_.ParentProcessId)\" + [char]9 + $_.CommandLine }";
  const table = new Map();
  for (const line of powershell(script).split(/\r?\n/)) {
    const [pid, parent, ...rest] = line.split("\t");
    if (!pid || !Number.isFinite(Number(pid))) continue;
    table.set(Number(pid), { parent: Number(parent), command: rest.join("\t").toLowerCase() });
  }
  return table;
}

// The links of a backend dev session above src/server.js. A terminal, an editor or anything else
// is not one, so the walk stops there and never reaches it.
const DEV_LINK = /nodemon|concurrently|devredis\.js|npm-cli\.js"?\s+run\s+dev\b|npm run dev\b|src[\\/]server\.js/;

/** The topmost process of the dev session `pid` belongs to: stopping it with /T stops the whole session. */
function sessionRoot(pid, table) {
  let root = pid;
  const seen = new Set([pid]);
  for (let current = table.get(pid); current && table.has(current.parent) && !seen.has(current.parent);) {
    const parent = table.get(current.parent);
    if (!DEV_LINK.test(parent.command)) break;
    seen.add(current.parent);
    root = current.parent;
    current = parent;
  }
  return root;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Stops every dev session holding the engine and waits for the file to be released. Returns how many were stopped. */
function freeEngine() {
  const holders = engineHolders();
  if (!holders.length) return 0;
  const table = processTable();
  const roots = [...new Set(holders.map((pid) => sessionRoot(pid, table)))];
  console.log(`Stopping ${roots.length === 1 ? "the backend dev server" : `${roots.length} backend dev servers`} so the query engine can be replaced...`);
  for (const pid of roots) {
    try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
  }
  // A holder that outlived its session root (it was reparented) is stopped on its own.
  for (const pid of holders) {
    try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
  }
  const deadline = Date.now() + RELEASE_WAIT_MS;
  while (engineHolders().length && Date.now() < deadline) sleep(500);
  return roots.length;
}

function sweepTempEngines() {
  if (!fs.existsSync(engineDir)) return 0;
  const leftovers = fs.readdirSync(engineDir).filter((name) => /^query_engine-.*\.tmp\d+$/.test(name));
  for (const name of leftovers) { try { fs.unlinkSync(path.join(engineDir, name)); } catch { /* in use: left for next time */ } }
  return leftovers.length;
}

function main() {
  const stopped = process.platform === "win32" ? freeEngine() : 0;
  const generate = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "generate", ...process.argv.slice(2)], { cwd: backendDir, stdio: "inherit", shell: process.platform === "win32" });
  const swept = sweepTempEngines();
  if (swept) console.log(`Removed ${swept} leftover engine cop${swept === 1 ? "y" : "ies"} from earlier failed attempts.`);
  if (generate.status !== 0) {
    console.error("\nprisma generate failed. If the error is EPERM on query_engine-windows.dll.node, a process this script could not stop still has the engine open (a test run, or Prisma Studio): close it and run `npm run prisma:generate` again.");
    process.exit(generate.status || 1);
  }
  if (stopped) console.log(`\nThe backend dev server${stopped === 1 ? " was" : "s were"} stopped to free the engine. Start it again with: npm run dev`);
}

// Only when run as a script, so the session walk can be checked on its own.
if (require.main === module) main();

module.exports = { sessionRoot };
