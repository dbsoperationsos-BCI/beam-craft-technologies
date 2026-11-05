const fs = require("fs");
const path = require("path");
const multer = require("multer");
const prisma = require("../../../config/db");
const { readableProject } = require("../../../services/projectScope");
const { compressImage } = require("../../../services/imageCompression");

const uploadRoot = path.join(__dirname, "..", "..", "..", "..", "uploads", "project-attachments");

function ensureUploadDir(projectId) {
  const dir = path.join(uploadRoot, projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        cb(null, ensureUploadDir(req.params.id));
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const safeName = String(file.originalname || "attachment").replace(/[^a-zA-Z0-9._-]+/g, "_");
      cb(null, `${Date.now()}-${safeName}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

async function listProjectAttachments(req, res) {
  try {
    // Through the project, never on the attachment's own terms: whoever the project belongs to owns
    // its files. A project this reader may not see is a 404, so the list cannot confirm it exists.
    const project = await readableProject({ userId: req.user.id, projectId: req.params.id, permissions: req.permission });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const data = await prisma.projectAttachment.findMany({
      where: { projectId: project.id, deletedAt: null },
      orderBy: [{ createdAt: "desc" }],
    });
    return res.json({
      data: data.map((item) => ({
        ...item,
        url: `/uploads/project-attachments/${project.id}/${item.storedName}`,
      })),
    });
  } catch (error) {
    console.error("Unable to load project attachments:", error);
    return res.status(500).json({ message: "Unable to load project attachments." });
  }
}

function uploadSingle(req, res, next) {
  return upload.single("file")(req, res, next);
}

/**
 * Compresses an uploaded image in place, the same way every other image in the app is compressed,
 * and answers with the file multer actually left on disk.
 *
 * Multer has already written the original to `uploadRoot`; this reads it back, re-encodes it to
 * WebP, and writes the result under a `.webp` name - `express.static` serves `/uploads` straight
 * off disk and reads its `Content-Type` from the extension, so the name has to agree with the
 * bytes it now holds, unlike an object-storage key whose reader trusts the stored metadata
 * instead. The original is removed once the compressed file is safely written. A photo
 * `compressImage` cannot shrink (corrupt, a format it does not decode) is left exactly as multer
 * wrote it - compression is a saving here too, never a reason to refuse the upload.
 */
async function compressStoredImage(file) {
  if (!file.mimetype?.startsWith("image/")) return file;
  try {
    const compressed = await compressImage(fs.readFileSync(file.path));
    const storedName = `${path.basename(file.filename, path.extname(file.filename))}.${compressed.extension}`;
    const storedPath = path.join(path.dirname(file.path), storedName);
    fs.writeFileSync(storedPath, compressed.buffer);
    if (storedPath !== file.path) fs.unlinkSync(file.path);
    return { ...file, filename: storedName, path: storedPath, mimetype: compressed.mimeType, size: compressed.buffer.length };
  } catch (error) {
    console.warn("[project-attachments] Image not compressed, storing as received:", error.message);
    return file;
  }
}

async function createProjectAttachment(req, res) {
  try {
    const project = await readableProject({ userId: req.user.id, projectId: req.params.id, permissions: req.permission });
    if (!project) return res.status(404).json({ message: "Project not found." });
    if (!req.file) return res.status(400).json({ message: "Please choose a file to upload." });
    const file = await compressStoredImage(req.file);
    const attachment = await prisma.projectAttachment.create({
      data: {
        projectId: project.id,
        originalName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        filePath: file.path,
        uploadedByUserId: req.user?.id || null,
      },
    });
    return res.status(201).json({
      data: { ...attachment, url: `/uploads/project-attachments/${project.id}/${attachment.storedName}` },
    });
  } catch (error) {
    console.error("Unable to save project attachment:", error);
    return res.status(500).json({ message: "Unable to save project attachment." });
  }
}

async function deleteProjectAttachment(req, res) {
  try {
    // The project is checked before the attachment, so deleting one belonging to a project this
    // reader cannot see fails the same way listing it does.
    const project = await readableProject({ userId: req.user.id, projectId: req.params.id, permissions: req.permission });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const attachment = await prisma.projectAttachment.findFirst({
      where: { id: req.params.attachmentId, projectId: req.params.id, deletedAt: null },
      select: { id: true, filePath: true },
    });
    if (!attachment) return res.status(404).json({ message: "Attachment not found." });
    await prisma.projectAttachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date() } });
    fs.promises.unlink(attachment.filePath).catch(() => {});
    return res.json({ message: "Attachment deleted successfully." });
  } catch (error) {
    console.error("Unable to delete project attachment:", error);
    return res.status(500).json({ message: "Unable to delete project attachment." });
  }
}

module.exports = {
  uploadSingle,
  createProjectAttachment,
  deleteProjectAttachment,
  listProjectAttachments,
  compressStoredImage,
};
