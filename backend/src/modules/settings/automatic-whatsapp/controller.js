const photoSelection = () => require("./photoSelection");
const iam = () => require("../../../services/iam.service");

/*
 * Settings → User Settings → Automatic WhatsApp Message → Photo Selection Submitted: the HTTP face of
 * `photoSelection.js`, in the shape Attendance WhatsApp Report's panel reads (every write answers
 * with the fresh status). Whether the reader may change anything is the permission's Read / Write,
 * answered here as `canChooseSenders`, which is what the panel gates its controls on.
 */
const statusFor = async (req) => photoSelection().status({ canChooseSenders: await iam().hasPermission(req.user.id, "SETTINGS", "Automatic WhatsApp Message", "READ_WRITE") });
const answered = (handler, fallback) => async (req, res) => {
  try {
    await handler(req);
    return res.json({ data: await statusFor(req) });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error(`${fallback}:`, error.message);
    return res.status(500).json({ message: `${fallback}.` });
  }
};

const getPhotoSelection = answered(async () => {}, "Unable to read the Photo Selection Submitted notification");
const setPhotoSelectionEnabled = answered((req) => photoSelection().setEnabled(req.body?.enabled), "Unable to switch the notification");
const setPhotoSelectionGroup = answered((req) => photoSelection().setGroupName(req.body?.groupName), "Unable to save the WhatsApp group's name");
const setPhotoSelectionSender = answered((req) => photoSelection().setSender(req.body || {}), "Unable to save the sender");
const listPhotoSelectionCandidates = async (req, res) => {
  try {
    return res.json({ data: await require("../../hrm/attendance/reportGroup").senderCandidates() });
  } catch (error) {
    console.error("Unable to list the senders:", error.message);
    return res.status(500).json({ message: "Unable to list who can send the notification." });
  }
};

/*
 * New Lead Welcome (`newLeadWelcome.js`): every answer is the fresh status, with `canWrite` - the
 * same permission's Read / Write - which is what the panel shows the switch to.
 */
const leadWelcome = () => require("./newLeadWelcome");
const leadWelcomeAnswered = (handler, fallback) => async (req, res) => {
  try {
    await handler(req);
    const canWrite = await iam().hasPermission(req.user.id, "SETTINGS", "Automatic WhatsApp Message", "READ_WRITE");
    return res.json({ data: await leadWelcome().status({ canWrite }) });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error(`${fallback}:`, error.message);
    return res.status(500).json({ message: `${fallback}.` });
  }
};
const getLeadWelcome = leadWelcomeAnswered(async () => {}, "Unable to read the New Lead Welcome message");
const setLeadWelcomeEnabled = leadWelcomeAnswered((req) => leadWelcome().setEnabled(req.body?.enabled), "Unable to switch the welcome message");

/*
 * Interview Welcome (`interviewWelcome.js`): the switch and who sends it, shown under Templates →
 * Interview Welcome beside the wording. Every answer is the fresh status, with `canWrite` as above.
 */
const interviewWelcome = () => require("./interviewWelcome");
const interviewWelcomeAnswered = (handler, fallback) => async (req, res) => {
  try {
    await handler(req);
    const canWrite = await iam().hasPermission(req.user.id, "SETTINGS", "Automatic WhatsApp Message", "READ_WRITE");
    return res.json({ data: await interviewWelcome().status({ canWrite }) });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error(`${fallback}:`, error.message);
    return res.status(500).json({ message: `${fallback}.` });
  }
};
const getInterviewWelcome = interviewWelcomeAnswered(async () => {}, "Unable to read the Interview Welcome message");
const setInterviewWelcomeEnabled = interviewWelcomeAnswered((req) => interviewWelcome().setEnabled(req.body?.enabled), "Unable to switch the interview message");
const setInterviewWelcomeSender = interviewWelcomeAnswered((req) => interviewWelcome().setSender(req.body || {}), "Unable to save the sender");

module.exports = {
  getPhotoSelection, setPhotoSelectionEnabled, setPhotoSelectionGroup, setPhotoSelectionSender, listPhotoSelectionCandidates, getLeadWelcome, setLeadWelcomeEnabled,
  getInterviewWelcome, setInterviewWelcomeEnabled, setInterviewWelcomeSender,
};
