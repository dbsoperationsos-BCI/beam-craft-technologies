const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

/*
 * The seal over Baileys' authentication state.
 *
 * What Baileys persists is the private key material of a linked WhatsApp device. It cannot be
 * rotated like a password - the only revocation is unlinking from the phone - so a copy of these
 * files is a working login for as long as nobody notices. Baileys' own `useMultiFileAuthState`
 * writes all of it as plain JSON.
 *
 * These tests hold the properties that make stealing the files insufficient on their own: the
 * bytes on disk do not contain the secret, a file edited on disk refuses to open rather than
 * being fed to the signal protocol, the key must be a real key, and a name arriving from the wire
 * cannot address anything outside its own folder.
 */

const KEY_A = crypto.randomBytes(32).toString("hex");
const KEY_B = crypto.randomBytes(32).toString("hex");

// Awaits the callback before putting the environment back. Restoring it synchronously around an
// async body unset the key while the writes were still in flight, which failed as "key not set"
// and looked like a fault in the module rather than in the test.
async function withKey(value, run) {
  const saved = process.env.WHATSAPP_SESSION_ENCRYPTION_KEY;
  if (value === undefined) delete process.env.WHATSAPP_SESSION_ENCRYPTION_KEY;
  else process.env.WHATSAPP_SESSION_ENCRYPTION_KEY = value;
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.WHATSAPP_SESSION_ENCRYPTION_KEY;
    else process.env.WHATSAPP_SESSION_ENCRYPTION_KEY = saved;
  }
}

const secure = require("../src/modules/sales/whatsapp-chat/secureAuthState");

test("a sealed file does not contain the secret it protects", async () => {
  await withKey(KEY_A, () => {
    const secret = "3A7F-noise-BAILEYS-PRIVATE-KEY-MATERIAL";
    const sealed = secure.seal(JSON.stringify({ noiseKey: secret }));
    assert.equal(sealed.includes(secret), false, "the plaintext must not survive into the file");
    assert.equal(secure.open(sealed), JSON.stringify({ noiseKey: secret }));
  });
});

test("the same input sealed twice produces different files", async () => {
  // A fresh IV per write. These files are rewritten on every message as the ratchet advances, and
  // reusing an IV under one key is what breaks GCM outright.
  await withKey(KEY_A, () => {
    const first = secure.seal("same");
    const second = secure.seal("same");
    assert.notEqual(first.toString("base64"), second.toString("base64"));
    assert.equal(secure.open(first), "same");
    assert.equal(secure.open(second), "same");
  });
});

test("a file edited on disk refuses to open", async () => {
  await withKey(KEY_A, () => {
    const sealed = secure.seal("credentials");
    // One flipped bit in the ciphertext. GCM authenticates, so this must throw rather than hand
    // back something the signal protocol would treat as genuine.
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0x01;
    assert.throws(() => secure.open(tampered));
  });
});

test("another key cannot open the file", async () => {
  const sealed = await withKey(KEY_A, () => secure.seal("credentials"));
  await withKey(KEY_B, () => {
    assert.throws(() => secure.open(sealed));
  });
});

test("a missing or weak key is refused rather than falling back to plaintext", async () => {
  // Failing to pair is recoverable. Quietly writing private keys in the clear is not.
  await withKey(undefined, () => assert.throws(() => secure.seal("x"), /WHATSAPP_SESSION_ENCRYPTION_KEY/));
  await withKey("", () => assert.throws(() => secure.seal("x"), /WHATSAPP_SESSION_ENCRYPTION_KEY/));
  await withKey("short", () => assert.throws(() => secure.seal("x"), /32 bytes/));
  await withKey("g".repeat(64), () => assert.throws(() => secure.seal("x"), /32 bytes/));
  // A placeholder rather than a generated key.
  await withKey("00".repeat(32), () => assert.throws(() => secure.seal("x"), /placeholder/));
});

test("credentials written before encryption existed are still readable", async () => {
  // An install that paired before this module must not have every CRM logged out by the upgrade.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wa-legacy-"));
  try {
    await fs.writeFile(path.join(dir, "creds.json"), JSON.stringify({ registered: true, me: { id: "1@s.whatsapp.net" } }));
    const creds = await withKey(KEY_A, () => secure.readCredentials(dir));
    assert.equal(creds?.registered, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a session survives a round trip through the auth state", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wa-auth-"));
  try {
    await withKey(KEY_A, async () => {
      const { state, saveCreds } = await secure.useEncryptedAuthState(dir);
      state.creds.me = { id: "919876543210@s.whatsapp.net" };
      state.creds.registered = true;
      await saveCreds();
      // The key material Baileys stores beside the credentials, which is as sensitive as they are.
      await state.keys.set({ "pre-key": { 1: { public: Buffer.from("public"), private: Buffer.from("private") } } });

      const onDisk = await fs.readFile(path.join(dir, "creds.json"));
      assert.equal(onDisk.includes("919876543210"), false, "the paired number must not be readable on disk");
      const preKeyOnDisk = await fs.readFile(path.join(dir, "pre-key-1.json"));
      assert.equal(preKeyOnDisk.includes("private"), false, "pre-keys must be sealed too, not just creds.json");

      const reopened = await secure.useEncryptedAuthState(dir);
      assert.equal(reopened.state.creds.me.id, "919876543210@s.whatsapp.net");
      const keys = await reopened.state.keys.get("pre-key", ["1"]);
      assert.equal(Buffer.from(keys["1"].private).toString(), "private");

      // Null means delete, which is what Baileys means by it.
      await reopened.state.keys.set({ "pre-key": { 1: null } });
      await assert.rejects(fs.access(path.join(dir, "pre-key-1.json")));
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// Windows has no POSIX permission bits (every file reads back 0o666), so there is nothing to
// check there; the server this protects runs on Linux.
test("session files are created unreadable to other accounts", { skip: process.platform === "win32" && "no POSIX permission bits on Windows" }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wa-perm-"));
  try {
    await withKey(KEY_A, async () => {
      const { saveCreds } = await secure.useEncryptedAuthState(path.join(dir, "user-1"));
      await saveCreds();
      const dirMode = (await fs.stat(path.join(dir, "user-1"))).mode & 0o777;
      const fileMode = (await fs.stat(path.join(dir, "user-1", "creds.json"))).mode & 0o777;
      assert.equal(dirMode, 0o700, "the session directory must not be readable by other accounts");
      assert.equal(fileMode, 0o600, "the credentials must not be readable by other accounts");
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a key id cannot address a file outside its own folder", () => {
  // Key ids arrive from the wire and land in file names.
  assert.equal(secure.fileNameFor("app-state-sync-key-../../creds.json"), "app-state-sync-key-..__..__creds.json");
  assert.equal(secure.fileNameFor("a:b/c"), "a-b__c");

  const root = path.resolve("/tmp/wa-root");
  assert.equal(secure.resolveInside(root, "creds.json"), path.join(root, "creds.json"));

  // Separators are neutralised rather than refused, so a hostile id becomes an ordinary file name
  // inside the folder instead of an error - what matters is that it can never point outside it.
  for (const hostile of ["../escaped.json", "../../creds.json", "/etc/passwd", "..\\..\\windows"]) {
    const resolved = secure.resolveInside(root, hostile);
    // A backslash is an ordinary character on Linux, where it is neutralised into a file name, but a
    // separator on Windows, where the second check refuses it outright. Refused is contained too.
    if (resolved === "" && process.platform === "win32" && hostile.includes("\\")) continue;
    assert.notEqual(resolved, "", `${hostile} should resolve to a contained name`);
    assert.ok(
      resolved.startsWith(root + path.sep),
      `${hostile} escaped the session folder: ${resolved}`,
    );
    assert.equal(path.dirname(resolved), root, `${hostile} must land directly in the folder`);
  }
});
