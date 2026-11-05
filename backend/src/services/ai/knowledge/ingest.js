const prisma = require("../../../config/db");
const { embed } = require("./embeddings");
const { redactSecrets } = require("../leadContext");
const { findModule, isGlobal } = require("../modules");

/**
 * Putting a document where the assistant can find it.
 *
 * Ingestion is an administrative act, not something a normal user does - a shared corpus that
 * anybody can write to is a corpus anybody can poison, and a passage saying "our refund policy is
 * to refund everything" would be quoted back with the studio's authority. The route that calls this
 * is restricted; this function assumes that has already happened.
 *
 * A document is stored once and read many times, so the work is done here: split, embed, and keep
 * the vectors. Retrieval then costs one embedding of the question.
 */

// Long enough to hold an idea, short enough that four of them still leave room for the question.
const CHUNK_CHARS = 900;
const CHUNK_OVERLAP = 150;

/**
 * Splits text into overlapping passages, preferring to break at a paragraph.
 *
 * The overlap is what stops an answer falling into the gap between two passages - a policy whose
 * condition is in one and whose exception is in the next.
 */
function chunk(text) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_CHARS) return [clean];

  const pieces = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      // Break at a paragraph if there is one nearby, then a sentence, then wherever we are.
      const paragraph = clean.lastIndexOf("\n\n", end);
      const sentence = clean.lastIndexOf(". ", end);
      if (paragraph > start + CHUNK_CHARS / 2) end = paragraph;
      else if (sentence > start + CHUNK_CHARS / 2) end = sentence + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) pieces.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return pieces;
}

/**
 * Stores a document and its embeddings.
 *
 * The module is checked against the registry, so a document cannot be filed under a scope that does
 * not exist - it would be unreachable, and unreachable knowledge looks like missing knowledge.
 */
async function ingestDocument({ title, module, visibility = "module", source, text, createdById } = {}) {
  const name = String(title || "").trim();
  if (!name) throw new Error("A document needs a title.");

  const scope = String(module || "").trim().toUpperCase();
  // GLOBAL is a real place to file company-wide material, even though it is not a permission.
  if (!isGlobal(scope) && !findModule(scope)) {
    throw new Error(`Unknown module for a document: ${module}`);
  }

  // Credentials get pasted into procedure documents - a wiki page explaining how to connect to
  // something, with the password still in it. Cleaned before it is stored, not before it is read.
  const body = redactSecrets(String(text || ""));
  const pieces = chunk(body);
  if (!pieces.length) throw new Error("That document has no text to store.");

  const vectors = await embed(pieces);

  return prisma.$transaction(async (tx) => {
    const document = await tx.aiDocument.create({
      data: {
        // Bounded like `source` below. The column is VarChar(255), and a document uploaded with a
        // very long name would otherwise fail the whole ingest after the embeddings were computed -
        // the same failure that lost a call transcript over an over-long call outcome.
        title: String(name).slice(0, 255),
        module: scope,
        visibility: visibility === "global" ? "global" : "module",
        source: source ? String(source).slice(0, 500) : null,
        createdById: createdById ?? null,
      },
      select: { id: true, title: true, module: true, visibility: true },
    });

    await tx.aiDocumentChunk.createMany({
      data: pieces.map((content, index) => ({
        documentId: document.id,
        ordinal: index,
        content,
        embedding: JSON.stringify(vectors[index]),
        // A rough count, for budgeting a prompt rather than for billing.
        tokenCount: Math.ceil(content.length / 4),
      })),
    });

    return { ...document, chunks: pieces.length };
  });
}

/** Documents the assistant holds, for an administrator to review. Never their contents. */
async function listDocuments({ module } = {}) {
  const where = module ? { module: String(module).trim().toUpperCase() } : {};
  return prisma.aiDocument.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, title: true, module: true, visibility: true, source: true, updatedAt: true,
      _count: { select: { chunks: true } },
    },
    take: 100,
  });
}

/** Removes a document and its passages. */
async function deleteDocument(id) {
  const documentId = String(id || "").trim();
  if (!documentId) return false;
  const existing = await prisma.aiDocument.findUnique({ where: { id: documentId }, select: { id: true } });
  if (!existing) return false;
  // Chunks go with it: the cascade is on the foreign key.
  await prisma.aiDocument.delete({ where: { id: documentId } });
  return true;
}

module.exports = { ingestDocument, listDocuments, deleteDocument, chunk, CHUNK_CHARS, CHUNK_OVERLAP };
