const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

/**
 * Baileys authentication state, encrypted on disk.
 *
 * What Baileys persists is not a password that can be changed - it is the private key material of
 * a linked WhatsApp device. Anyone holding a copy can speak as the studio's number from anywhere,
 * and the only revocation is unlinking the device from the phone. Baileys' own
 * `useMultiFileAuthState` writes all of it as plain JSON, so a stray backup, a container image, a
 * mounted volume or a misread path exposed a usable login.
 *
 * This is a drop-in replacement for that helper. Same contract - `{ state, saveCreds }`, same file
 * names, same read/write points - with every file sealed with AES-256-GCM under a key that lives
 * only in the environment. GCM rather than CBC because it authenticates as well as hides: a file
 * edited on disk fails to open rather than being fed to the signal protocol as if it were genuine.
 *
 * It deliberately encrypts *every* file, not just `creds.json`. The pre-key, session, sender-key
 * and app-state-sync files beside it are the rest of the same secret; encrypting the first and
 * leaving the others is a lock on one door of an open house.
 *
 * Not a claim of safety on its own. A reader who has the key *and* the files still has the
 * session - the point is that neither half is enough by itself, so a leaked backup, a database
 * dump or a log file does not hand over a working login.
 */

const ALGORITHM = "aes-256-gcm";
// Marks a file as sealed by this module, and says which format it is in. Anything without it is
// treated as a plaintext file written before encryption existed.
const MAGIC = Buffer.from("DBSWA1\n", "utf8");
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

class SessionEncryptionError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionEncryptionError";
  }
}

/**
 * The key, read fresh each time rather than captured at import.
 *
 * Never defaulted and never derived from something guessable: a WhatsApp login protected by a
 * fallback constant is protected by nothing, and a key baked into the image travels wherever the
 * image does. Missing is an error rather than a silent fall back to plaintext, because failing to
 * pair is recoverable and quietly writing private keys in the clear is not.
 */
function encryptionKey() {
  const raw = String(process.env.WHATSAPP_SESSION_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    throw new SessionEncryptionError(
      "WHATSAPP_SESSION_ENCRYPTION_KEY is not set. WhatsApp sessions cannot be stored without it. Generate one with: openssl rand -hex 32",
    );
  }

  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else if (/^[A-Za-z0-9+/=]{44}$/.test(raw)) key = Buffer.from(raw, "base64");

  if (!key || key.length !== KEY_BYTES) {
    throw new SessionEncryptionError(
      "WHATSAPP_SESSION_ENCRYPTION_KEY must be 32 bytes, as 64 hex characters or base64. Generate one with: openssl rand -hex 32",
    );
  }
  // A key of one repeated byte is a typo or a placeholder, never a generated key.
  if (key.every((byte) => byte === key[0])) {
    throw new SessionEncryptionError("WHATSAPP_SESSION_ENCRYPTION_KEY looks like a placeholder rather than a generated key.");
  }
  return key;
}

// Whether a usable key is configured, for a startup check that wants to warn rather than throw.
function hasEncryptionKey() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

// A fresh IV per write. Reusing one under the same key is what breaks GCM outright, and these
// files are rewritten constantly - every message advances the ratchet and saves new keys.
function seal(plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

/**
 * Opens a file, whichever way it was written.
 *
 * A directory paired before this module existed holds plaintext JSON, and refusing it would log
 * every already-linked CRM out and make them scan again. So plaintext is read once and rewritten
 * sealed by the next save, which Baileys performs constantly.
 */
function open(buffer) {
  if (!buffer || buffer.length === 0) return "";
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) return buffer.toString("utf8");

  const iv = buffer.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = buffer.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const body = buffer.subarray(MAGIC.length + IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/**
 * Baileys' own file naming, reproduced exactly.
 *
 * Key ids arrive from the wire and land in file names, so `/` and `:` are replaced rather than
 * trusted. Combined with the containment check below, a crafted id cannot address anything
 * outside the session folder.
 */
function fileNameFor(file) {
  return String(file).replace(/\//g, "__").replace(/:/g, "-");
}

// The resolved path, refused if it would leave the session folder. Belt and braces over the name
// rewriting above: two independent checks, so one being wrong is not enough.
function resolveInside(dir, file) {
  const root = path.resolve(dir);
  const target = path.resolve(root, fileNameFor(file));
  if (target !== root && !target.startsWith(root + path.sep)) return "";
  return target;
}

/**
 * Replaces the file rather than editing it.
 *
 * Written to a temporary name and renamed, which is atomic on the same filesystem: a process
 * killed mid-write leaves the previous credentials intact instead of a truncated file that fails
 * to open and forces a re-pair. Created 0600 so only the account running the server can read it.
 */
async function writeFileAtomic(target, contents) {
  const temporary = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { mode: 0o600 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * The credentials for one linked account, or null.
 *
 * Reads through the same seal as everything else, so callers asking "is this account paired"
 * never open the raw file themselves and never have to know how it is stored.
 */
async function readCredentials(dir) {
  const { BufferJSON } = require("@whiskeysockets/baileys");
  const target = resolveInside(dir, "creds.json");
  if (!target) return null;
  try {
    const contents = open(await fs.readFile(target));
    return contents ? JSON.parse(contents, BufferJSON.reviver) : null;
  } catch {
    // Unreadable is the same answer as absent: not paired. A file that fails to open - wrong key,
    // truncated, tampered with - must not be reported as a live login.
    return null;
  }
}

/**
 * The same shape `useMultiFileAuthState` returns, sealed.
 *
 * `keys.set` is where the ratchet advances: Baileys hands over pre-keys, sessions, sender keys and
 * app-state sync keys as the conversation moves, and each one is as sensitive as the credentials
 * themselves. They go through the same seal, and a null value deletes the file rather than
 * writing an empty one, which is what Baileys means by it.
 */
async function useEncryptedAuthState(dir) {
  const { initAuthCreds, BufferJSON, proto } = require("@whiskeysockets/baileys");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // Tightened even when the directory already existed, so an install that started before this
  // module is brought up to the same permissions rather than left world-readable.
  await fs.chmod(dir, 0o700).catch(() => {});

  const writeData = async (data, file) => {
    const target = resolveInside(dir, file);
    if (!target) return;
    await writeFileAtomic(target, seal(JSON.stringify(data, BufferJSON.replacer)));
  };

  const readData = async (file) => {
    const target = resolveInside(dir, file);
    if (!target) return null;
    try {
      const contents = open(await fs.readFile(target));
      return contents ? JSON.parse(contents, BufferJSON.reviver) : null;
    } catch {
      return null;
    }
  };

  const removeData = async (file) => {
    const target = resolveInside(dir, file);
    if (!target) return;
    await fs.rm(target, { force: true }).catch(() => {});
  };

  const creds = (await readData("creds.json")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(`${type}-${id}.json`);
            // Baileys expects this one back as a message type rather than a plain object.
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data || {})) {
            for (const id of Object.keys(data[category] || {})) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, "creds.json"),
  };
}

module.exports = {
  useEncryptedAuthState,
  readCredentials,
  hasEncryptionKey,
  SessionEncryptionError,
  // Exported for their own tests: the seal is the whole security property, and it has to be
  // provable without pairing a real WhatsApp account.
  seal,
  open,
  fileNameFor,
  resolveInside,
};
