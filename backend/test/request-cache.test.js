const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { requestCache, remember, forgetRequestCache } = require("../src/services/requestCache");

const inRequest = (fn) => new Promise((resolve, reject) => requestCache({}, {}, () => Promise.resolve().then(fn).then(resolve, reject)));

test("one request reads a remembered answer once, however many checks ask", async () => {
  let loads = 0;
  const result = await inRequest(async () => {
    const [a, b] = await Promise.all([remember("k", async () => ++loads), remember("k", async () => ++loads)]);
    return [a, b, await remember("k", async () => ++loads)];
  });
  assert.deepEqual(result, [1, 1, 1]);
  assert.equal(loads, 1);
});

test("nothing outlives the request - the next one reads fresh", async () => {
  let loads = 0;
  await inRequest(() => remember("k", async () => ++loads));
  await inRequest(() => remember("k", async () => ++loads));
  assert.equal(loads, 2);
});

test("outside a request it simply loads, and a write forgets what was read", async () => {
  let loads = 0;
  await remember("k", async () => ++loads);
  await remember("k", async () => ++loads);
  assert.equal(loads, 2);
  await inRequest(async () => {
    await remember("k", async () => ++loads);
    forgetRequestCache();
    await remember("k", async () => ++loads);
  });
  assert.equal(loads, 4);
});

test("a failed load is not remembered", async () => {
  let loads = 0;
  await inRequest(async () => {
    await assert.rejects(remember("k", async () => { loads += 1; throw new Error("down"); }));
    assert.equal(await remember("k", async () => ++loads), 2);
  });
});

test("the permission service reads the user and the grants through it, and the server mounts it", () => {
  const iam = fs.readFileSync(path.join(__dirname, "..", "src", "services", "iam.service.js"), "utf8");
  assert.match(iam, /return remember\(`iam:user:\$\{userId\}`, \(\) => this\._loadUserWithPermissions\(userId\)\);/);
  assert.match(iam, /return remember\(`iam:permissions:\$\{userId\}`, \(\) => this\._loadUserPermissions\(userId\)\);/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8"), /app\.use\(requestCache\);/);
});

test("every user, role and grant write forgets the request's reads, after the write lands", () => {
  const iam = fs.readFileSync(path.join(__dirname, "..", "src", "services", "iam.service.js"), "utf8");
  for (const name of ["createUser", "updateUser", "assignRoleToUser", "removeRoleFromUser", "createRole", "updateRole", "addPermissionToRole", "updateRolePermission", "removePermissionFromRole"]) {
    assert.match(iam, new RegExp(`"${name}"`), `${name} is not wrapped`);
  }
  assert.match(iam, /return await write\.apply\(this, args\);\n\s+\} finally \{\n\s+forgetRequestCache\(\);/);
  const admin = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "admin", "routes.js"), "utf8");
  assert.equal((admin.match(/forgetRequestCache\(\); \/\/ what this request read/g) || []).length, 8);
  assert.match(admin, /\n  \}\);\n  forgetRequestCache\(\); \/\/ what this request read about users and roles is now out of date\n\}/, "the role matrix clears after its transaction");
});
