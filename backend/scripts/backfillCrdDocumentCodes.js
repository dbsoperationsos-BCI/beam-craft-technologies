#!/usr/bin/env node
/* eslint-disable no-console */
const prisma = require("../src/config/db");
const { nextIdentifier } = require("../src/services/identifiers");

/*
 * ── The CRD documents that were never given an identifier ─────────────────────────────────────
 *
 * A document raised from **Create CRD Document** was created with no `document_code`. Only two
 * paths ever wrote one - issuing a project's own link, and a project adopting a hand-raised
 * document when it is later started as "Applicable" - and a document raised by hand reaches
 * neither: that button exists precisely for a project answered "Not Applicable", and such a project
 * never adopts. So those documents stood on the register with the CRD ID column blank for good.
 *
 * Most visible on Qua Qua, where the projects are the ones being answered "Not Applicable" and then
 * given a document by hand. `createDocument` now mints the code as it creates the row; this fills
 * in the rows created before it did.
 *
 * ── Why a script rather than SQL in a migration ──
 *
 * The rule is `services/identifiers.js`: which vertical the code carries, how the number is padded,
 * and what the next number in that vertical's run actually is. Written again in SQL it would be a
 * second copy of that rule, drifting from the first. So this runs the real thing, one row at a
 * time, in the order the documents were created - which is the order their numbers should read in.
 *
 * A document already holding a code is never touched, so running this twice is safe and a
 * half-finished run can simply be run again.
 *
 *   node scripts/backfillCrdDocumentCodes.js            # say what would change, write nothing
 *   node scripts/backfillCrdDocumentCodes.js --apply    # do it
 */

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.salesProjectCrdDocument.findMany({
    where: { documentCode: null },
    select: { id: true, vertical: true, projectId: true, enquiryId: true, createdAt: true },
    // Oldest first, so the numbers run in the order the documents were raised rather than in
    // whatever order the database happened to hand them back.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  // `projectId` is a plain column rather than a relation, so the projects are read alongside.
  const projects = new Map((await prisma.salesProject.findMany({
    where: { id: { in: rows.map((row) => row.projectId).filter(Boolean) } },
    select: { id: true, vertical: true, eventId: true },
  })).map((project) => [project.id, project]));

  if (!rows.length) {
    console.log("Every CRD document already carries an identifier. Nothing to do.");
    return;
  }

  console.log(`${rows.length} CRD document(s) with no identifier.${APPLY ? "" : " Dry run - nothing will be written. Pass --apply to do it."}\n`);
  for (const row of rows) {
    // The document's own vertical, then the project's. A hand-raised document has no project and
    // carries the vertical the create dialog asked for; one raised before that column was written
    // has only its project's.
    const project = row.projectId ? projects.get(row.projectId) : null;
    const vertical = row.vertical || project?.vertical || null;
    if (!vertical) {
      // Named rather than skipped quietly: a code without a vertical would read DBS-CRD--000001,
      // and a row nobody can name is a row somebody has to look at.
      console.log(`  ${row.id}  SKIPPED - no vertical on the document or its project`);
      continue;
    }
    if (!APPLY) {
      console.log(`  ${row.id}  ${vertical}  (${project?.eventId || row.enquiryId || "no project"})  ->  next ${vertical} number`);
      continue;
    }
    const documentCode = await nextIdentifier("CRD_DOCUMENT", { vertical });
    await prisma.salesProjectCrdDocument.update({ where: { id: row.id }, data: { documentCode } });
    console.log(`  ${row.id}  ->  ${documentCode}`);
  }
}

main()
  .catch((error) => { console.error("Failed:", error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
