const { z } = require("zod");

const folderName = z.string().trim().min(1, "Folder name is required.").max(191, "Folder name must be 191 characters or fewer.");
const projectParamsSchema = z.object({ projectId: z.string().trim().min(1).max(191) });
const folderParamsSchema = projectParamsSchema.extend({ folderId: z.string().trim().min(1).max(191) });
const createFolderSchema = z.object({ name: folderName, parentId: z.string().trim().min(1).max(191).nullable().optional() });
const renameFolderSchema = z.object({ name: folderName });

module.exports = { projectParamsSchema, folderParamsSchema, createFolderSchema, renameFolderSchema };
