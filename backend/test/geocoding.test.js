const test = require("node:test");
const assert = require("node:assert/strict");

const { formatAddress, reverseGeocode, MIN_GAP_MS } = require("../src/services/geocoding");

/**
 * Turning coordinates into an address.
 *
 * Two things are worth testing without a network. The formatting, because Nominatim's own
 * `display_name` is a paragraph and the value of this feature is a *label* — and because its
 * address object repeats names across levels in a way that reads as a mistake. And the failure
 * behaviour, because this is called after an attendance record is already written: every way of not
 * getting an answer has to be null, never a throw.
 */

test("an address reads as somebody would say it, not as Nominatim returns it", () => {
  const payload = {
    display_name: "45, Perundurai Road, Veerappanchatram, Erode, Erode District, Tamil Nadu, 638011, India",
    address: {
      house_number: "45",
      road: "Perundurai Road",
      suburb: "Veerappanchatram",
      city: "Erode",
      state_district: "Erode District",
      state: "Tamil Nadu",
      postcode: "638011",
      country: "India",
    },
  };
  // The road wins over the suburb, and the country is dropped — nobody says the country about a
  // colleague's check-in.
  assert.equal(formatAddress(payload), "Perundurai Road, Erode, Erode District, Tamil Nadu, 638011");
});

test("a name repeated across levels is said once", () => {
  // Nominatim frequently returns a town that is also its own district. "Erode, Erode, Tamil Nadu"
  // reads like a bug in the application rather than a quirk of the data.
  const line = formatAddress({ address: { road: "Bazaar Street", town: "Erode", county: "Erode", state: "Tamil Nadu" } });
  assert.equal(line, "Bazaar Street, Erode, Tamil Nadu");
});

test("a thin answer still gives a line, and an empty one gives nothing", () => {
  assert.equal(formatAddress({ address: { state: "Tamil Nadu" } }), "Tamil Nadu");
  // No address object at all: fall back to whatever display_name there is rather than losing it.
  assert.equal(formatAddress({ display_name: "Somewhere" }), "Somewhere");
  assert.equal(formatAddress({}), null);
  assert.equal(formatAddress(null), null);
  assert.equal(formatAddress({ address: {} }), null);
});

test("a point that is not a point is refused before any request is made", async () => {
  /*
   * No network is touched by any of these, and the test asserts that by timing: a lookup that
   * reached the queue would pay the one-second rate limit, so six of them returning in a moment is
   * the proof that none of them left the process.
   *
   * `[null, null]` is the case worth naming. `Number(null)` is 0, and 0,0 is a real place in the
   * Atlantic — so a capture that reported no position would have been geocoded to Null Island and
   * had that stored as its address.
   */
  const started = Date.now();
  for (const [lat, lon] of [[null, null], ["abc", "def"], [91, 0], [0, 181], [undefined, undefined], [NaN, 0], ["", ""], [true, true], [{}, []]]) {
    assert.equal(await reverseGeocode(lat, lon), null, `${lat},${lon}`);
  }
  assert.ok(Date.now() - started < 500, "one of those reached the network");
});

test("the lookup can be switched off entirely, and answers null when it is", async () => {
  // Proven by running the module with the flag set, since it is read once at load.
  const { execFileSync } = require("node:child_process");
  const script = 'const g = require("./src/services/geocoding"); g.reverseGeocode(11.35, 77.69).then((r) => { console.log(JSON.stringify(r)); });';
  const out = execFileSync(process.execPath, ["-e", script], {
    cwd: require("node:path").join(__dirname, ".."),
    env: { ...process.env, GEOCODING_ENABLED: "false" },
    encoding: "utf8",
    timeout: 20000,
  });
  assert.equal(out.trim(), "null");
});

test("the rate limit is the one Nominatim's policy asks for", () => {
  // One request per second, with a little headroom. Stated as a constant so that changing it is a
  // deliberate act rather than a tuning tweak — going faster than this is a policy violation, not
  // an optimisation.
  assert.ok(MIN_GAP_MS >= 1000, `${MIN_GAP_MS}ms is faster than one request per second`);
});
