const prisma = require("../../../config/db");
const repository = require("./repository");
const { transcribeRecording, TranscriptionError } = require("./transcriber");
const { assignSpeakers } = require("./speakers");
const { analyseTranscript } = require("./analyst");
const { APPLICABLE_FIELDS, LEAD_STATUS_VALUES } = require("./constants");

/**
 * One recording, from a URL to a transcript the CRM can show.
 *
 * Download, convert, transcribe, guess who is speaking, then ask Claude what the call was about.
 * The last step is optional and its failure is not the job's failure - the transcript is the part
 * worth keeping, and re-running the whole thing to retry a summary would spend minutes of CPU on
 * something a person can read for themselves.
 */

/** The call this recording belongs to, for the direction and the client's name. */
async function callLogFor(callLogId) {
  try {
    const [row] = await prisma.$queryRawUnsafe(
      "SELECT `call_type` AS `callType`, `client_name` AS `clientName`, `employee_name` AS `employeeName`," +
      " `recording_url` AS `recordingUrl`, `duration_seconds` AS `durationSeconds`" +
      " FROM `sales_crm_call_log` WHERE `id` = ? LIMIT 1",
      String(callLogId || ""),
    );
    return row || null;
  } catch (error) {
    // The call log table is created at runtime by the CRM module; if it is not there yet, the
    // transcript can still be made, just without the direction to attribute speakers by.
    console.warn("[call-transcript] could not read the call log:", error?.message || error);
    return null;
  }
}

/** The transcript as one readable block, which is what search and the model both read. */
function toFullText(segments) {
  return segments.map((segment) => segment.text).join(" ").replace(/\s+/g, " ").trim();
}

async function processTranscription(transcriptId) {
  const transcript = await repository.findById(transcriptId);
  if (!transcript) return { skipped: "GONE" };
  // A second delivery of the same call arrives while the first is still queued. Nothing to redo.
  if (transcript.status === "COMPLETED") return { skipped: "ALREADY_DONE" };

  await repository.markProcessing(transcriptId);
  const callLog = await callLogFor(transcript.callLogId);
  const recordingUrl = transcript.recordingUrl || callLog?.recordingUrl || "";

  if (!recordingUrl) {
    // Not every call has a recording - a missed call never does. That is an outcome, not a fault,
    // and it is recorded as one so the panel can say so instead of showing a spinner for ever.
    throw new TranscriptionError("NO_RECORDING", "This call has no recording to transcribe.", { permanent: true });
  }

  const result = await transcribeRecording(recordingUrl);
  const segments = assignSpeakers(result.segments, { callType: callLog?.callType });
  const fullText = toFullText(segments);

  /*
   * The reading is attempted, never insisted on.
   *
   * No API key, a rate limit, a model that times out - all of them leave a stored transcript with
   * no summary, which the panel shows plainly. Throwing here would mark the whole job failed and
   * retry minutes of transcription to fix a paragraph.
   */
  let analysis = null;
  if (fullText) {
    try {
      analysis = await analyseTranscript({
        fullText,
        callType: callLog?.callType,
        durationSeconds: result.durationSeconds,
        clientName: callLog?.clientName,
        language: result.language,
        translated: result.translated,
      });
    } catch (error) {
      console.warn("[call-transcript] analysis failed:", error?.message || error);
    }
  }

  await repository.saveCompleted(transcriptId, {
    fullText,
    language: result.language,
    durationSeconds: result.durationSeconds,
    provider: result.provider,
    segments,
    analysis,
  });
  return { transcriptId, segments: segments.length, analysed: Boolean(analysis) };
}

/**
 * The suggestions a person may apply, as {field: value} in the CRM's own names.
 *
 * Built from an allowlist, so a field name arriving from the browser cannot reach a column nobody
 * meant to expose, and a suggested status that is not one of the CRM's own is dropped rather than
 * written. Empty values are left out: applying a suggestion must never blank a filled-in field.
 */
function applicableSuggestions(suggestions) {
  const parsed = typeof suggestions === "string" ? JSON.parse(suggestions || "{}") : (suggestions || {});
  const out = {};
  for (const [field, spec] of Object.entries(APPLICABLE_FIELDS)) {
    const value = parsed[spec.from];
    if (value === null || value === undefined || String(value).trim() === "") continue;
    if (field === "leadStatus" && !LEAD_STATUS_VALUES.includes(String(value))) continue;
    out[field] = String(value).trim();
  }
  return out;
}

module.exports = { processTranscription, applicableSuggestions, toFullText };
