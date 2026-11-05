/*
 * One-time cleanup: the WhatsApp chat files the CRM used to keep in R2.
 *
 * Until October 2026 every photo, voice note, video and document in a CRM WhatsApp thread was
 * copied into the bucket under `crm/whatsapp-chat/`. The CRM no longer keeps them - View and
 * Download fetch each file from WhatsApp when asked, and the studio's phone holds the rest - so
 * these copies are what this removes, and the stored paths pointing at them with them.
 *
 *   node scripts/one-off/purgeWhatsappChatMedia.js            # dry run: count and size only
 *   node scripts/one-off/purgeWhatsappChatMedia.js --execute  # delete
 *
 * Only `crm/whatsapp-chat/` is touched. Remark attachments (`crm/remarks/…`) and everything else
 * in the bucket are not listed, let alone deleted. A delete cannot be undone.
 */
require("dotenv").config();
const { ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const prisma = require("../../src/config/db");
const { r2Client, bucket, isConfigured } = require("../../src/config/r2");

const PREFIX = "crm/whatsapp-chat/";
const execute = process.argv.includes("--execute");
const mb = (bytes) => (Number(bytes || 0) / 1024 ** 2).toFixed(1);

async function listAll() {
  const objects = [];
  let token;
  do {
    const page = await r2Client().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token }));
    for (const item of page.Contents || []) objects.push({ key: item.Key, size: Number(item.Size) || 0 });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function main() {
  if (!isConfigured) throw new Error("R2 is not configured in this environment's .env.");
  const objects = await listAll();
  const total = objects.reduce((sum, item) => sum + item.size, 0);
  const clients = new Set(objects.map((item) => item.key.slice(PREFIX.length).split("/")[0]));
  console.log(`Bucket ${bucket}, ${PREFIX}: ${objects.length} files, ${mb(total)} MB, ${clients.size} client folders.`);

  if (!execute) {
    console.log("Dry run - nothing deleted. Run again with --execute to delete them.");
    return;
  }

  let deleted = 0;
  for (let index = 0; index < objects.length; index += 1000) {
    const chunk = objects.slice(index, index + 1000);
    const result = await r2Client().send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: chunk.map((item) => ({ Key: item.key })), Quiet: true },
    }));
    for (const error of result.Errors || []) console.error(`Not deleted: ${error.Key} (${error.Message})`);
    deleted += chunk.length - (result.Errors || []).length;
  }
  // The rows that pointed at those files. The app no longer reads the column; this keeps it honest.
  const cleared = await prisma.$executeRawUnsafe(
    "UPDATE `SalesCrmWhatsAppMessage` SET `mediaPath` = NULL WHERE `mediaPath` LIKE ?",
    `${PREFIX}%`,
  ).catch((error) => {
    console.warn("Stored paths not cleared:", error.message);
    return 0;
  });
  console.log(`Deleted ${deleted} of ${objects.length} files. Cleared ${Number(cleared) || 0} stored paths.`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
