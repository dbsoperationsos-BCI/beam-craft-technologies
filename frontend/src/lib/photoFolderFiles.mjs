import { SUPPORTED_IMAGE_EXTENSIONS } from "@/lib/imageUploadValidation.mjs";

/*
 * Reading photos out of what a studio drops or picks: a folder handle, a dropped folder, or loose
 * files. Shared by every drop zone that takes photos (`PhotoDropZone`) - Photo Selection's upload
 * and the Signature Album's - so a folder is read one way everywhere.
 */

// Windows does not map HEIC or TIFF to a MIME type, so "image/*" alone would grey them out
// in the picker. The extensions come from the validator to keep the two in step.
export const PHOTO_ACCEPT = ["image/*", ...Array.from(SUPPORTED_IMAGE_EXTENSIONS, (extension) => `.${extension}`)].join(",");

function readFileEntry(entry) { return new Promise((resolve, reject) => entry.file(resolve, reject)); }
async function readDirectoryEntries(directory) { const reader = directory.createReader(); const entries = []; while (true) { const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject)); if (!batch.length) return entries; entries.push(...batch); } }

/**
 * Every photo inside a picked folder, each tagged with its trail from that folder down.
 *
 * The trail starts with the folder's own name so it reads exactly like the `webkitRelativePath` the
 * file input reports — `Folder 2/DSC08659.JPG` — and both routes therefore store the same shape.
 * It is stamped onto the File because a File's own `webkitRelativePath` is read-only and empty for
 * anything that came from a directory handle.
 */
export async function collectFromDirectory(handle, trail) {
  const files = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "directory") { files.push(...(await collectFromDirectory(entry, [...trail, entry.name]))); continue; }
    const file = await entry.getFile();
    try { file.dbsRelativePath = [...trail, entry.name].join("/"); } catch { /* a frozen File keeps its name alone */ }
    files.push(file);
  }
  return files;
}

export async function collectDroppedFiles(dataTransfer) { const entries = Array.from(dataTransfer.items || []).map((item) => item.webkitGetAsEntry?.()).filter(Boolean); if (!entries.length) return Array.from(dataTransfer.files || []); const files = []; const pending = [...entries]; while (pending.length) { const entry = pending.shift(); if (entry.isFile) files.push(await readFileEntry(entry)); else if (entry.isDirectory) pending.push(...(await readDirectoryEntries(entry))); } return files; }
