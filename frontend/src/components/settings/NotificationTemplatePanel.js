"use client";

/*
 * Settings → Templates → one automatic WhatsApp message, laid out as Interview Welcome is: the
 * notification - whether it is sent, when, from whose WhatsApp and into which group - above its
 * wording, with the wording's placeholders and preview under it.
 *
 * The two halves keep their own permissions, and each is passed only when the reader holds it: the
 * notification card answers to the notification's own permission and the wording to
 * `SETTINGS / Message Template`, as they did when they were two screens. Each still saves through
 * its own endpoint, so nothing about how the message is sent moved with it.
 */
export default function NotificationTemplatePanel({ notification = null, message = null }) {
  return <div className="max-w-5xl space-y-4">
    {notification}
    {message}
  </div>;
}
