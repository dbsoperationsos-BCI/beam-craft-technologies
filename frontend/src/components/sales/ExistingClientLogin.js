"use client";

import RecordSummaryCard from "@/components/shared/RecordSummaryCard";

/**
 * Client Credentials for a returning client: their number already has a login, made with an earlier
 * event. No new login and no new password - this project shows in the same app login, through the
 * number. Shown on Create Project as the number is typed, and on Edit Sale Details.
 */
/** Whether the client has set their own password in the app yet, or still has the studio's. */
export function clientPasswordLabel(login) {
  return login.passwordChanged ? "Set by the client" : "Studio's password - not changed yet";
}

export default function ExistingClientLogin({ login }) {
  return <div className="space-y-2">
    <RecordSummaryCard rows={[["Username", login.username], ["Status", login.active ? "Active" : "Switched off"], ["Password", clientPasswordLabel(login)]]} />
    <p className="text-xs text-slate-500 sm:text-sm">
      This client already has a login from an earlier event. No new login is needed - this project
      shows in their app with the same username and password.
    </p>
  </div>;
}
