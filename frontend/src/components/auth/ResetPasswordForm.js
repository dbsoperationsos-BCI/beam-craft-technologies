"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { resetPassword } from "@/services/auth/auth.service";

/*
 * The rules, ticked off as somebody types.
 *
 * The mirror of this list is `backend/src/services/passwordPolicy.js`, which is what actually
 * enforces them - this one is here so the requirements are readable while the password is being
 * chosen rather than reported after it is rejected.
 */
const requirements = [
  { label: "At least 8 characters", test: (value) => value.length >= 8 },
  { label: "One upper case letter", test: (value) => /[A-Z]/.test(value) },
  { label: "One lower case letter", test: (value) => /[a-z]/.test(value) },
  { label: "One number", test: (value) => /[0-9]/.test(value) },
  { label: "One special character", test: (value) => /[^A-Za-z0-9]/.test(value) },
];

export default function ResetPasswordForm() {
  const [password, setPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState(""); const [showPassword, setShowPassword] = useState(false); const [showConfirm, setShowConfirm] = useState(false); const { notice, showNotice, showError, clearNotice } = useNotice();
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  // The token from the emailed link. Without it there is nothing to reset against.
  const token = useSearchParams().get("token") || "";

  /*
   * Checks what can be checked here, then lets the server check the rest.
   *
   * The requirements below are the same ones the list shows, so they are worth answering before a
   * round trip. Whether the token is still good is not something the browser can know, so that
   * answer comes back from the server and is shown as it is.
   */
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    if (!token) return showError("This reset link is not valid. Please request a new one.");
    if (password !== confirmPassword) return showError("Passwords do not match.");
    if (!requirements.every((requirement) => requirement.test(password))) return showError("Please meet all security requirements.");

    setSaving(true);
    try {
      await resetPassword({ token, password });
      /*
       * Straight to sign-in, which is what somebody is here to do.
       *
       * The confirmation is shown by the login page rather than here - the token is spent, so this
       * page has nothing left to offer, and a message on a page that is about to be replaced is one
       * nobody finishes reading.
       */
      router.push("/login?reset=1");
    } catch (error) {
      showError(error.message || "Unable to reset your password. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  return <div><p className="text-lg font-semibold text-slate-800">DBS - CRM</p><h1 className="mt-10 text-3xl font-semibold tracking-tight text-slate-900">Set new password</h1><p className="mt-3 text-sm text-slate-500">Please enter new password</p><FloatingNotice notice={notice} onClose={clearNotice} /><form onSubmit={submit} className="mt-7 space-y-5"><PasswordField label="New password" value={password} onChange={setPassword} visible={showPassword} onToggle={() => setShowPassword((visible) => !visible)} /><PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} visible={showConfirm} onToggle={() => setShowConfirm((visible) => !visible)} /><div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-sm font-semibold text-slate-700">Security Requirements</p><ul className="mt-3 space-y-2 text-sm">{requirements.map((requirement) => <li key={requirement.label} className={requirement.test(password) ? "text-emerald-600" : "text-slate-500"}>{requirement.test(password) ? "✓" : "○"} {requirement.label}</li>)}</ul></div><button type="submit" disabled={saving} className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300">{saving ? "Updating..." : "Update password"}</button></form><Link href="/login" className="mt-8 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">← Back to login</Link></div>;
}

function PasswordField({ label, value, onChange, visible, onToggle }) {
  return <label className="block text-sm font-medium text-slate-700">{label}<div className="relative mt-2"><input required type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-3 pr-16 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /><button type="button" onClick={onToggle} className="absolute inset-y-0 right-3 text-sm text-slate-500 hover:text-slate-800">{visible ? "Hide" : "Show"}</button></div></label>;
}
