"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import SendWhatsAppButton from "@/components/shared/SendWhatsAppButton";
import ShareableMessage from "@/components/shared/ShareableMessage";
import useMessageTemplate from "@/components/shared/useMessageTemplate";
import useWhatsappSender from "@/components/shared/useWhatsappSender";
import Dialog from "@/components/ui/Dialog";
import { feedbackMessage, feedbackTemplateKey } from "@/lib/feedbackMessage.mjs";
import { sendFeedbackWhatsApp } from "@/services/project-management/feedback.service";

/**
 * Feedback → after Save Feedback: the message the client is answered with, by where the feedback
 * was filed.
 *
 * The message sits in the shared box with its Copy, as Client Login Ready and CRD Link Ready show
 * theirs, with Send WhatsApp beside Close: sent from this person's own WhatsApp to the client's own
 * number on the project - absent while their WhatsApp is not linked, or the message is switched off
 * under Settings → Templates. What is sent is the text in the box, as edited. A **Completed** feedback (Excellent or Good) is answered with the
 * studio's **Feedback Thank You** - thanks, a request for a review on the branch's Google page and
 * its social media to follow, from Settings → Organization → Branches. An **Issues** one (Average or
 * Poor) with **Feedback Issues** - thanks for the prompt feedback, the Feedback ID to quote, and word
 * that the team will sort it out. Both are worded in Settings → Message Templates.
 */
export default function FeedbackMessageDialog({ feedback, onClose }) {
  const completed = feedback.status === "Completed";
  const templateKey = feedbackTemplateKey(feedback.status);
  const template = useMessageTemplate(templateKey);
  const { canSend } = useWhatsappSender(templateKey);
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const message = feedbackMessage(template, {
    status: feedback.status,
    clientName: feedback.clientName,
    // Feedback is on the project as a whole, so the message thanks the client for feedback on their project.
    shoot: "project",
    eventId: feedback.eventId,
    feedbackCode: feedback.feedbackCode,
    socialLinks: feedback.socialLinks,
  });

  async function sendOnWhatsApp(body) {
    setResult(null);
    try {
      const response = await sendFeedbackWhatsApp(feedback.id, body);
      setResult({ tone: "success", text: response?.message || "Sent on WhatsApp to the client." });
    } catch (error) {
      setResult({ tone: "error", text: error?.message || "Unable to send this message on WhatsApp." });
    }
  }

  return <Dialog
    title={completed ? "Feedback Completed" : "Feedback Filed Under Issues"}
    description={completed
      ? `${feedback.projectName || feedback.eventId || "The project"} was rated ${feedback.review}. Send or copy this to thank the client and ask them to review and follow the studio.`
      : `${feedback.projectName || feedback.eventId || "The project"} was rated ${feedback.review}. Send or copy this to let the client know the team will sort it out.`}
    size="md"
    onClose={onClose}
    footer={<>
      {feedback.id && canSend && <SendWhatsAppButton className="max-sm:flex-1" message={text} onSend={sendOnWhatsApp} />}
      <Button className="max-sm:flex-1" type="button" onClick={onClose}>Close</Button>
    </>}
  >
    <div className="space-y-2">
      <ShareableMessage label="Message to send the client" message={message} rows={10} onTextChange={setText} />
      {result && <p role={result.tone === "error" ? "alert" : "status"} className={`text-xs ${result.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>{result.text}</p>}
    </div>
  </Dialog>;
}
