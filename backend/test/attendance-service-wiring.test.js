const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

/**
 * That the attendance service's own helpers are actually wired up.
 *
 * This exists because of a real bug. `fillEventAddress` called `reverseGeocode` and the import for
 * it was never written — a script that made two edits and asserted on the second discarded both, so
 * the function shipped referring to a name that did not exist.
 *
 * Nothing caught it. The module loaded, because the reference is inside a function body; every unit
 * test passed, because none of them called it; and lint did not run over the backend. What it did
 * at runtime was throw a `ReferenceError` **synchronously** inside the check-in handler's try block
 * — after the attendance row was written — so a person marking their day had it recorded and was
 * told the server had failed.
 *
 * The lesson is narrow and worth a test: a fire-and-forget helper must not be able to throw into the
 * caller that deliberately did not await it.
 */

const run = (script) => execFileSync(process.execPath, ["-e", script], {
  cwd: path.join(__dirname, ".."),
  // No network: the point is the wiring, not the lookup.
  env: { ...process.env, GEOCODING_ENABLED: "false" },
  encoding: "utf8",
  timeout: 30000,
});

test("the deferred address lookup cannot throw into the caller that did not await it", () => {
  const out = run(`
    const service = require("./src/modules/hrm/attendance/service");
    try {
      service.fillEventAddress(0, 11.35, 77.69);
      console.log("OK");
    } catch (error) {
      console.log("THREW:" + error.constructor.name + ":" + error.message);
    }
  `);
  assert.equal(out.trim(), "OK", "fillEventAddress threw synchronously into its caller");
});

test("nothing the service exports is undefined", () => {
  /*
   * The same class of fault, caught cheaply: an export naming something that was never defined, or
   * renamed on one side only. `module.exports` happily takes an undefined identifier and every
   * caller then reads it as "not a function" at the moment it is needed.
   *
   * String constants are exports too — `APPROVAL_MODULE` and its pair — so this checks for absence
   * rather than for a type.
   */
  const out = run(`
    const service = require("./src/modules/hrm/attendance/service");
    const missing = Object.entries(service).filter(([, value]) => value === undefined).map(([name]) => name);
    console.log(JSON.stringify(missing));
  `);
  assert.deepEqual(JSON.parse(out.trim()), []);
});
