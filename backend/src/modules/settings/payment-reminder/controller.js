const service = require("./service");

/*
 * Settings → Project Management → Payment reminder (`service.js`): read on SETTINGS / Payment Reminder
 * Read, set on Read / Write - the router's `requireModule` follows the method. Each answers the
 * reminder as it now stands.
 */
const iam = () => require("../../../services/iam.service");
const statusFor = async (req) => service.reminderStatus({ canChooseSenders: await iam().hasPermission(req.user.id, "SETTINGS", "Payment Reminder", "READ_WRITE") });
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

const getReminder = answered(async () => {}, "Unable to read the payment reminder");
const setReminderSendAt = answered((req) => service.setSendAt(req.body?.sendAt), "Unable to save when the payment reminders are sent");
const setReminderSender = answered((req) => service.setSender(req.body || {}), "Unable to save the sender");
const listReminderCandidates = async (req, res) => {
  try {
    return res.json({ data: await require("../../hrm/attendance/reportGroup").senderCandidates() });
  } catch (error) {
    console.error("Unable to list the senders:", error.message);
    return res.status(500).json({ message: "Unable to list who can send the payment reminders." });
  }
};

module.exports = { getReminder, setReminderSendAt, setReminderSender, listReminderCandidates };
