const { z } = require("zod");

// A root's name is an identity other records will point at, so it is kept short, trimmed, and
// never blank. Notes are free text for the studio ("the Synology in the edit room").
const nameSchema = z.string().trim().min(1, "Enter a storage root name.").max(100);
const notesSchema = z.string().trim().max(500).nullish().transform((value) => (value ? value : null));
// The mounted location. Stored, never opened, by this server — the desktop resolves and reads it.
const mappedPathSchema = z.string().trim().max(1024).nullish().transform((value) => (value ? value : null));

const createStorageRootSchema = z.object({ name: nameSchema, notes: notesSchema, mappedPath: mappedPathSchema });
// Update applies only what was sent, the same convention the project settings save follows.
const updateStorageRootSchema = z.object({ name: nameSchema.optional(), notes: notesSchema.optional(), mappedPath: mappedPathSchema.optional() });
const storageRootIdSchema = z.object({ storageRootId: z.string().trim().min(1).max(191) });

module.exports = { createStorageRootSchema, updateStorageRootSchema, storageRootIdSchema };
