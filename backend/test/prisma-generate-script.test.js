const test = require("node:test");
const assert = require("node:assert/strict");
const { sessionRoot } = require("../scripts/prismaGenerate");

// The chain `npm run dev` builds on Windows, as Win32_Process reports it (lower-cased), under a
// PowerShell terminal that is not in the table because it is neither node nor cmd.
const devSession = () => new Map([
  [100, { parent: 1, command: "\"c:\\program files\\nodejs\\node.exe\" \"c:\\program files\\nodejs/node_modules/npm/bin/npm-cli.js\" run dev" }],
  [101, { parent: 100, command: "c:\\windows\\system32\\cmd.exe /d /s /c concurrently -k -n redis,api -c yellow,cyan \"npm:dev:redis\" \"npm:dev:server\"" }],
  [102, { parent: 101, command: "\"node\" \"c:\\repo\\backend\\node_modules\\.bin\\\\..\\concurrently\\dist\\bin\\concurrently.js\" -k -n redis,api" }],
  [103, { parent: 102, command: "cmd.exe /s /c \"npm run dev:server\"" }],
  [104, { parent: 103, command: "\"c:\\program files\\nodejs\\\\node.exe\" \"c:\\program files\\nodejs\\\\node_modules\\npm\\bin\\npm-cli.js\" run dev:server" }],
  [105, { parent: 104, command: "c:\\windows\\system32\\cmd.exe /d /s /c nodemon src/server.js" }],
  [106, { parent: 105, command: "\"node\" \"c:\\repo\\backend\\node_modules\\.bin\\\\..\\nodemon\\bin\\nodemon.js\" src/server.js" }],
  [107, { parent: 106, command: "\"c:\\program files\\nodejs\\node.exe\" src/server.js" }],
]);

test("the server holding the engine is stopped through the npm run dev it belongs to, so its Redis goes too", () => {
  assert.equal(sessionRoot(107, devSession()), 100);
});

test("the walk stops at anything that is not part of a dev session", () => {
  const table = devSession();
  // An editor's own node process (a language server, the frontend) above the session is left alone.
  table.set(1, { parent: 0, command: "\"node\" c:\\repo\\frontend\\node_modules\\next\\dist\\bin\\next dev" });
  assert.equal(sessionRoot(107, table), 100);
  // A server started on its own (`npm start`, `node src/server.js`) is stopped by itself.
  const alone = new Map([[200, { parent: 199, command: "\"node.exe\" src/server.js" }], [199, { parent: 0, command: "cmd.exe" }]]);
  assert.equal(sessionRoot(200, alone), 200);
});

test("a process whose parent is gone is its own root", () => {
  assert.equal(sessionRoot(300, new Map([[300, { parent: 999, command: "\"node.exe\" src/server.js" }]])), 300);
});
