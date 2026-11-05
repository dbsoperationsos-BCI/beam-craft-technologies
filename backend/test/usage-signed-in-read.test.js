const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * The two reads behind Application Usage's time columns, against a stubbed database: the stretches,
 * and the sign-in lines that say how long somebody was signed in. What matters is who they are
 * about - both are narrowed to the reader's people, in the same order their values are bound - and
 * that a database without the audit log still answers.
 */

const prisma = require("../src/config/db");
const { measuredUsage } = require("../src/modules/sales/crm-reports/service");

const ist = (day, time) => new Date(`${day}T${time}+05:30`);
const scope = { sql: ({ user, branch }) => ({ clause: `(${user} IN (?, ?) OR ${branch} = ?)`, params: [7, 8, 3] }) };

function stubbed(answer) {
  const calls = [];
  const original = prisma.$queryRawUnsafe;
  prisma.$queryRawUnsafe = async (sql, ...params) => { calls.push({ sql, params }); return answer(sql, params); };
  return { calls, restore: () => { prisma.$queryRawUnsafe = original; } };
}

test("the sign-in lines are read for the reader's people only, with the values bound in the clauses' order", async () => {
  const db = stubbed((sql) => (sql.includes("user_activity_log")
    ? [{ employee: "A", action: "Login", at: ist("2026-10-21", "09:00:00") }]
    : [{ employee: "A", day: ist("2026-10-21", "00:00:00"), seconds: 3600, sessions: 2, spanSeconds: 7200, lastLoginAt: null }]));
  try {
    const measured = await measuredUsage({ from: "2026-10-21", to: "2026-10-21", context: "app", scope, employees: ["A"], now: ist("2026-10-25", "12:00:00") });
    assert.equal(db.calls.length, 2);
    const [stretches, lines] = db.calls;
    // Both reads narrow on the joined `user` row, by name and by the reader's scope.
    for (const call of db.calls) {
      assert.match(call.sql, /COALESCE\(NULLIF\(TRIM\(`u`\.`name`\), ''\), 'Unknown'\) IN \(\?\)/);
      assert.match(call.sql, /\(`u`\.`id` IN \(\?, \?\) OR `u`\.`branch_id` = \?\)/);
    }
    // Stretches: the range, then the context, then the people - and the values in that order.
    assert.deepEqual(stretches.params, ["2026-10-20 18:30:00.000", "2026-10-21 18:29:59.999", "app", "A", 7, 8, 3]);
    // Sign-in lines: only successful Login and Logout lines, the people, then the range.
    assert.match(lines.sql, /`l`\.`module` = 'Auth' AND `l`\.`action` IN \('Login', 'Logout'\) AND `l`\.`status_code` = 200/);
    assert.ok(lines.sql.indexOf("'Unknown') IN (?)") < lines.sql.indexOf("`l`.`created_at` >= ?"), "the people clauses come before the date bounds");
    assert.deepEqual(lines.params, ["A", 7, 8, 3, "2026-10-20 18:30:00.000", "2026-10-21 18:29:59.999"]);
    // Signed in 09:00 to the end of the day is 15h; an hour of it was used.
    assert.equal(measured.get("A").inactiveSeconds, 15 * 3600 - 3600);
  } finally {
    db.restore();
  }
});

test("a database without the audit log falls back to the span of each day's use rather than failing", async () => {
  const db = stubbed((sql) => {
    if (sql.includes("user_activity_log")) throw new Error("Table 'dbs_hrm.user_activity_log' doesn't exist");
    return [{ employee: "A", day: ist("2026-10-21", "00:00:00"), seconds: 3600, sessions: 2, spanSeconds: 7200, lastLoginAt: null }];
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const measured = await measuredUsage({ from: "2026-10-21", to: "2026-10-21", context: "app" });
    assert.equal(measured.get("A").seconds, 3600);
    assert.equal(measured.get("A").inactiveSeconds, 7200 - 3600);
  } finally {
    console.warn = warn;
    db.restore();
  }
});

test("the WhatsApp context never reads the sign-in lines", async () => {
  const db = stubbed(() => []);
  try {
    await measuredUsage({ from: "2026-10-21", to: "2026-10-21", context: "whatsapp" });
    assert.equal(db.calls.length, 1);
    assert.doesNotMatch(db.calls[0].sql, /user_activity_log/);
  } finally {
    db.restore();
  }
});
