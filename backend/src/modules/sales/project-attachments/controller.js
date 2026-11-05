const fs = require("fs");
const path = require("path");
const multer = require("multer");
const prisma = require("../../../config/db");
const { readableProject } = require("../../../services/projectScope");

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

async function createProjectAttachment(req, res) {
  try {
    const project = await readableProject({ userId: req.user.id, projectId: req.params.id, permissions: req.permission });
    if (!project) return res.status(404).json({ message: "Project not found." });
    if (!req.file) return res.status(400).json({ message: "Please choose a file to upload." });
    const attachment = await prisma.projectAttachment.create({
      data: {
        projectId: project.id,
        originalName: req.file.originalname,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        filePath: req.file.path,
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
};
