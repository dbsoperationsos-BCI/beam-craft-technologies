require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const uploadRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../uploads/image-selection"));

async function clearDirectoryContents(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return clearDirectoryContents(target);
    await fs.rm(target, { force: true });
  }));
  return entries.length;
}

async function main() {
  const [projectCount, uploadCount] = await Promise.all([prisma.imageSelectionProject.count(), prisma.imageSelectionUpload.count()]);
  await prisma.$transaction(async (tx) => {
    await tx.imageSelectionPhotoSelection.deleteMany({});
    await tx.imageSelectionUpload.deleteMany({});
    await tx.imageSelectionUploadBatch.deleteMany({});
    // Folder parents are protected by a self-referencing RESTRICT relation.
    await tx.imageSelectionFolder.updateMany({ data: { parentId: null } });
    await tx.imageSelectionFolder.deleteMany({});
    await tx.imageSelectionProject.deleteMany({});
  });
  const fileCount = await clearDirectoryContents(uploadRoot);
  console.log(`Removed ${projectCount} Image Selection project(s), ${uploadCount} upload record(s), and ${fileCount} upload directory item(s).`);
}

main().finally(() => prisma.$disconnect());
