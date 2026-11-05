"use client";

import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import { generateTemporaryPassword } from "@/lib/temporaryPassword.mjs";

/*
 * Create Project → Client Credentials: the client's own sign-in, made with the project.
 *
 * Modelled on Employee Preference → Credentials, with the rules the server checks again
 * (`clientLoginFor`): a Username and a generated Temporary Password. The Username is the client's
 * mobile number - the ten digits of the project's Client Main Number (`clientUsernameFor`) - shown
 * here as it will be and never typed, so it follows the number as it is filled in. No email - a client signs in
 * by username, and the details reach them on WhatsApp: Save Project shows the message before it is
 * sent. What it makes is an account with the CLIENT role, linked to this project, that can sign in
 * and change its password and reach nothing of the studio's. What a client sees once signed in is
 * still to be built.
 */
export default function ClientCredentialsSection({ value, username, onChange, errors = {}, disabled = false, usernameHint = "The client's mobile number, from Client Main Number in the project details.", hint = "Generated for this login. Saving the project shows the WhatsApp message that sends it to the client." }) {
  return <div className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2">
      {/* The client's mobile number, taken from Client Main Number - read, never typed. */}
      <TextField
        label="Username"
        helperText={`What the client signs in with. ${usernameHint}`}
        readOnly
        value={username}
        error={errors.username}
        placeholder="Filled from Client Main Number"
        inputClassName="min-h-10 font-mono tracking-wide"
      />
    </div>
    <div className="flex flex-wrap items-end gap-2">
      {/* Generated, never typed - so no required mark on a field nobody can fill in. */}
      <TextField label="Temporary Password" helperText={`The client's first password; press Regenerate for a new one. ${hint}`} readOnly value={value.temporaryPassword} error={errors.temporaryPassword} className="min-w-0 flex-1 basis-56 md:max-w-sm" inputClassName="min-h-10 font-mono tracking-wide" />
      <Button type="button" variant="secondary" onClick={() => onChange("temporaryPassword", generateTemporaryPassword())} disabled={disabled} className="shrink-0">Regenerate</Button>
    </div>
  </div>;
}
