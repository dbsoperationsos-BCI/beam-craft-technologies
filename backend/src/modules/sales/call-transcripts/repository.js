const prisma = require("../../../config/db");

/**
 * Reading and writing transcripts.
 *
 * Through the Prisma client rather than raw SQL: these two tables are declared in the schema and
 * created by a migration, unlike the CRM's runtime tables, so the generated client knows them and
 * there is nothing to spell by hand.
 */

/**
 * The row a job works against, created before the job runs.
 *
 * Written on the webhook's thread so the CRM shows "Pending" the moment a call arrives rather than
 * showing nothing until a worker picks it up. Keyed on the call log, so a redelivered Callyzer
 * batch finds the existing row instead of queueing the same recording again.
 */
async function ensureTranscript({ callLogId, enquiryId, recordingUrl }) {
  const id = String(callLogId || "").trim();
  if (!id) return null;
  return prisma.salesCallTranscript.upsert({
    where: { callLogId: id },
    // The lead can change - a call log is re-pointed when leads merge - and a recording URL can
    // appear on a later delivery. Neither resets a transcript that has already been made.
    update: { enquiryId: String(enquiryId || "").trim() || null, recordingUrl: recordingUrl || undefined },
    create: {
      callLogId: id,
      // Nothing, not "", for a call the studio has not turned into an enquiry: the column is a key now.
      enquiryId: String(enquiryId || "").trim() || null,
      recordingUrl: recordingUrl || null,
      status: "PENDING",
    },
  });
}

function markProcessing(id) {
  return prisma.salesCallTranscript.update({
    where: { id },
    data: { status: "PROCESSING", errorCode: null, errorMessage: null, attempts: { increment: 1 } },
  });
}

/**
 * The finished transcript and everything read out of it.
 *
 * Segments are replaced rather than added to, so a re-run leaves one clean set instead of two
 * interleaved copies.
 */
async function saveCompleted(id, { fullText, language, durationSeconds, provider, segments, analysis }) {
  return prisma.$transaction(async (tx) => {
    await tx.salesCallTranscriptSegment.deleteMany({ where: { transcriptId: id } });
    if (segments.length) {
      await tx.salesCallTranscriptSegment.createMany({
        data: segments.map((segment) => ({
          transcriptId: id,
          sequence: segment.sequence,
          startMs: segment.startMs,
          endMs: segment.endMs,
          speaker: segment.speaker,
          text: segment.text,
        })),
      });
    }
    return tx.salesCallTranscript.update({
      where: { id },
      data: {
        status: "COMPLETED",
        fullText,
        language: fit("language", language),
        durationSeconds: durationSeconds || 0,
        provider: fit("provider", provider),
        summary: analysis?.summary || null,
        sentiment: fit("sentiment", analysis?.sentiment),
        callOutcome: analysis?.callOutcome || null,
        nextAction: analysis?.nextAction || null,
        suggestions: analysis ? JSON.stringify(analysis) : null,
        errorCode: null,
        errorMessage: null,
      },
    });
  });
}

/*
 * Every bounded column on this table, and what it will take.
 *
 * Written down because the alternative is remembering, and remembering failed: `markFailed` below
 * has always clamped its two columns, `markCompleted` clamped none of them, and the day a model
 * wrote a two-sentence call outcome the whole update was rejected - losing a transcript that had
 * already been produced, over a field nobody would have missed if it had simply been shorter.
 *
 * A transcript is expensive: a download, a conversion, and a minute of CPU. Throwing one away
 * because a summary ran long is the wrong trade every time, so the value is cut and the transcript
 * is kept.
 *
 * TEXT and LONGTEXT columns are absent on purpose - `fullText`, `summary`, `callOutcome`,
 * `nextAction` and `suggestions` have no length worth enforcing here.
 */
const COLUMN_LIMITS = {
  language: 20,
  provider: 60,
  sentiment: 30,
  errorCode: 60,
  errorMessage: 2000,
};

/** A value cut to what its column will hold, or null. Never throws on a non-string. */
function fit(column, value) {
  if (value === null || value === undefined || value === "") return null;
  const limit = COLUMN_LIMITS[column];
  const text = String(value);
  return limit ? text.slice(0, limit) : text;
}

function markFailed(id, { code, message }) {
  return prisma.salesCallTranscript.update({
    where: { id },
    data: {
      status: "FAILED",
      // Through the same table as everything else, so there is one place that knows the limits.
      errorCode: fit("errorCode", code) || "FAILED",
      errorMessage: fit("errorMessage", message) || "Transcription failed.",
    },
  });
}

function findById(id) {
  return prisma.salesCallTranscript.findUnique({
    where: { id },
    include: { segments: { orderBy: { sequence: "asc" } } },
  });
}

/**
 * Every transcript on one lead, newest first, without the segments.
 *
 * The list is a summary view - date, outcome, player - and a lead with twenty calls would other-
 * wise carry thousands of segment rows to render six cards. The full text is fetched per call.
 */
function listForLead(enquiryId, limit = 100) {
  return prisma.salesCallTranscript.findMany({
    where: { enquiryId: String(enquiryId || "").trim() },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 100, 1), 200),
    select: {
      id: true, callLogId: true, enquiryId: true, recordingUrl: true, status: true,
      language: true, durationSeconds: true, provider: true, summary: true, sentiment: true,
      callOutcome: true, nextAction: true, suggestions: true, appliedAt: true, appliedFields: true,
      errorCode: true, errorMessage: true, attempts: true, createdAt: true,
    },
  });
}

/**
 * Every transcript against a set of calls, newest first, without the segments.
 *
 * Beside `listForLead` and selecting exactly what it selects. A lead is found by its enquiry id;
 * a **candidate** has no enquiry id and never will - the Interview register knows a person by their
 * number - so its calls are found first and their transcripts fetched by those ids.
 *
 * An empty list in means an empty list out rather than every transcript in the table: `in: []`
 * would be a query nobody asked for, and the caller that passes nothing is a candidate with no
 * calls, which has no transcripts by definition.
 */
function listForCallLogs(callLogIds = [], limit = 100) {
  const ids = [...new Set((Array.isArray(callLogIds) ? callLogIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return Promise.resolve([]);
  return prisma.salesCallTranscript.findMany({
    where: { callLogId: { in: ids } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 100, 1), 200),
    select: {
      id: true, callLogId: true, enquiryId: true, recordingUrl: true, status: true,
      language: true, durationSeconds: true, provider: true, summary: true, sentiment: true,
      callOutcome: true, nextAction: true, suggestions: true, appliedAt: true, appliedFields: true,
      errorCode: true, errorMessage: true, attempts: true, createdAt: true,
    },
  });
}

function markApplied(id, { userId, fields }) {
  return prisma.salesCallTranscript.update({
    where: { id },
    data: {
      appliedAt: new Date(),
      appliedByUserId: userId ?? null,
      appliedFields: JSON.stringify(fields).slice(0, 2000),
    },
  });
}

/** Rows left mid-flight by a restart, so a redeploy does not strand a call as PROCESSING for ever. */
function listStuck(olderThanMs = 30 * 60 * 1000) {
  return prisma.salesCallTranscript.findMany({
    where: { status: { in: ["PENDING", "PROCESSING"] }, updatedAt: { lt: new Date(Date.now() - olderThanMs) } },
    select: { id: true, callLogId: true },
    take: 100,
  });
}

module.exports = {
  ensureTranscript, markProcessing, saveCompleted, markFailed,
  findById, listForLead, listForCallLogs, markApplied, listStuck,
};
