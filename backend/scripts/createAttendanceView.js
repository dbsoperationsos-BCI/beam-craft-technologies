/**
 * Creates (or refreshes) the read-only view `attendance_capture_ist`: every attendance capture with
 * its time in IST and a link to its selfie, for reading the table by hand in Workbench.
 *
 * A view rather than new columns, because the stored data stays exactly as the application needs
 * it: times in UTC - Prisma reads every DATETIME as UTC, so storing IST would shift every screen by
 * five and a half hours - and the selfie as an object key, never a link. The view only presents
 * them differently; nothing is written, and dropping it changes nothing.
 *
 * A script rather than a migration, because the link is built from this environment's
 * `R2_PUBLIC_BASE_URL`, which differs between machines - a migration would bake one environment's
 * address into every other. Safe to run against production: it issues `CREATE OR REPLACE VIEW`
 * and nothing else. Run it again after `prisma migrate reset`, which drops the view with the
 * database, or after changing the storage settings.
 *
 * `selfie_url` opens only while selfies sit in the public bucket (`R2_PRIVATE_BUCKET_NAME` unset),
 * and then it opens for anybody who has it. Once a private bucket is configured the column is NULL:
 * a private object has no public address, and the picture is read through the application instead.
 *
 *   npm run db:attendance-view
 */
const prisma = require("../src/config/db");
const { privateBucketIsPublic, publicBaseUrl } = require("../src/config/r2");

const VIEW = "attendance_capture_ist";

/**
 * The base URL as a SQL string literal. A view definition cannot take bound parameters, so the value
 * is checked against a strict URL shape first and refused if it could carry anything but a URL.
 */
function baseUrlLiteral() {
  const base = String(publicBaseUrl || "").trim().replace(/\/+$/, "");
  if (!privateBucketIsPublic || !base) return "NULL";
  if (!/^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~\/-]*)?$/.test(base)) {
    throw new Error(`R2_PUBLIC_BASE_URL does not look like a plain https URL, so it is not written into the view: ${base}`);
  }
  return `'${base}/'`;
}

async function main() {
  const base = baseUrlLiteral();
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE VIEW ${VIEW} AS
    SELECT
      ev.id                                             AS event_id,
      ev.session_id                                     AS session_id,
      e.employee_id                                     AS employee_code,
      e.employee_name                                   AS employee_name,
      ev.type                                           AS capture_type,
      CONVERT_TZ(ev.captured_at, '+00:00', '+05:30')    AS captured_at_ist,
      ev.captured_at                                    AS captured_at_utc,
      s.work_date                                       AS work_date,
      ev.latitude                                       AS latitude,
      ev.longitude                                      AS longitude,
      ev.accuracy_m                                     AS accuracy_m,
      ev.location_address                               AS location_address,
      ev.location_verified                              AS location_verified,
      ev.distance_meters                                AS distance_meters,
      ev.location_note                                  AS location_note,
      ev.face_verified                                  AS face_verified,
      ev.selfie_key                                     AS selfie_key,
      IF(ev.selfie_key IS NULL, NULL, CONCAT(${base}, ev.selfie_key)) AS selfie_url,
      ev.device_info                                    AS device_info
    FROM attendance_event ev
    JOIN attendance_session s ON s.id = ev.session_id
    JOIN employee e ON e.id = ev.employee_id
  `);
  const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM ${VIEW}`);
  console.log(`View ${VIEW} is ready with ${Number(count)} capture(s).`);
  console.log(base === "NULL"
    ? "selfie_url is NULL: selfies are in a private bucket (or no public URL is set), so they have no public link."
    : "selfie_url links to the public bucket: anybody who has one of these links can open that selfie.");
}

main()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
