const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The seed does not decide the Super Admin's password after somebody has chosen their own.
 *
 * `prisma/seed.js` creates that account with a password written into the file - which means a
 * password that is in the git repository and readable by everyone who has ever cloned it. Creating
 * it with one is fine and necessary; the account has to start somewhere. Putting it *back* on every
 * run is not.
 *
 * And the seed is not a first-install-only step. Adding a permission to
 * `seeds/iam-roles-permissions.js` and reseeding is how a new module or feature becomes grantable at
 * all - CLAUDE.md Rule 4 says so in as many words - so this runs on the VPS in the ordinary course
 * of shipping a feature. With `password` in the `update` block, every one of those runs quietly put
 * the studio's highest-privilege account back on a published credential, and nothing said so.
 *
 * Read from the file rather than by running it: the seed writes to a database, and what is being
 * checked here is what it is *willing* to write.
 */

const SEED = fs.readFileSync(path.join(__dirname, "..", "prisma", "seed.js"), "utf8");

/** The `upsert` that makes the Super Admin, split into the two branches it chooses between. */
function adminUpsert() {
  const from = SEED.indexOf("const user = await prisma.user.upsert({");
  assert.notEqual(from, -1, "the Super Admin is no longer created by a `prisma.user.upsert`");
  const block = SEED.slice(from, SEED.indexOf("});", from));
  const updateAt = block.indexOf("update: {");
  const createAt = block.indexOf("create: {");
  assert.ok(updateAt !== -1 && createAt !== -1 && updateAt < createAt, "the upsert no longer has an update and a create branch in that order");
  return { update: block.slice(updateAt, createAt), create: block.slice(createAt) };
}

test("an existing Super Admin keeps whatever password it has", () => {
  const { update } = adminUpsert();
  assert.ok(
    !/\bpassword\s*:/.test(update),
    "the seed sets a password on an *existing* Super Admin, so every reseed - including the ones "
      + "Rule 4 asks for on the VPS - puts the studio back on the password written in this repository",
  );
});

test("a Super Admin that does not exist yet is still given one", () => {
  // The other half: an account has to start somewhere, and a create with no password would make a
  // login nobody can ever sign in to.
  const { create } = adminUpsert();
  assert.match(create, /\bpassword\s*:\s*passwordHash\b/, "a newly seeded Super Admin is created with no password");
});

test("the seed still asserts the stored credential is a hash", () => {
  /*
   * The check that used to compare the stored hash against the seed's own password had to change
   * with the rule above - on a studio that has changed its password that comparison is false by
   * design, and a seed that threw at them would be fixed by putting the overwrite back.
   *
   * What it asserts now is the property that is true either way and is the one that matters: the
   * column holds a bcrypt hash rather than a password in plain text.
   */
  assert.match(SEED, /looksHashed/, "the seed no longer checks that the credential is hashed");
  assert.match(SEED, /\/\^\\\$2\[aby\]\\\$\\d\{2\}\\\$\//, "the hash check is not testing for a bcrypt prefix");
  assert.match(SEED, /throw new Error\("Seeded password verification failed/);
});

test("the account still has the seed's other facts asserted on every run", () => {
  /*
   * Dropping the password from `update` must not turn into dropping the rest. These four really are
   * the seed's to keep true: the account must be a super admin, it must be active, it must carry the
   * expected username, and it must not be pinned to a branch.
   */
  const { update } = adminUpsert();
  for (const field of ["username", "role", "status", "branchId"]) {
    // `name: value` or the ES6 shorthand `name,` - `username` is written the short way.
    const written = new RegExp(`\\b${field}\\s*(:|,)`);
    assert.match(update, written, `the seed no longer asserts ${field} on an existing Super Admin`);
  }
});
