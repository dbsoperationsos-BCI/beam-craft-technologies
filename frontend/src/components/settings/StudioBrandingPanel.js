"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import ImageUploadField from "@/components/shared/ImageUploadField";
import { updateStudioBranding } from "@/components/shared/useStudioBranding";
import { brandingSavedNotice, hasBrandingChanges } from "@/lib/studioBranding.mjs";
import { FALLBACK_LOGIN_EMAIL_DOMAIN, loginEmail } from "@/lib/employeeName.mjs";
import { FAVICON_ACCEPT, MAX_FAVICON_BYTES } from "@/lib/favicon.mjs";
import { getImageSelectionSettings, saveImageSelectionSettings } from "@/services/image-selection/image-selection.service";

/**
 * The global name and logo used by every client gallery - "Global Logo" in Settings.
 *
 * Its own file rather than a function inside one overlay, because the section moved: it was under
 * User Settings and belongs under the application's Settings, after Project Settings. Extracting it
 * is what makes that a move rather than a second copy - `SettingsOverlay` renders this, and nothing
 * else draws these two fields.
 *
 * It reads and writes through the existing Image Selection settings record rather than introducing a
 * second branding setting. Public galleries already read that record, so a save here is immediately
 * the logo clients see. That record is also why this is administrator's work and not a user
 * preference: its routes answer for ADMIN / System Settings, so a role without that write was being
 * shown a form the server would refuse. The caller does the gating; see `SettingsOverlay`.
 */
/*
 * `onNotice` and `onError` hand the outcome to Settings' own snackbar - the one every other section
 * here reports through - rather than printing it under the form. A line of text beside the Save
 * button is easy to miss on a long form, and "Favicon saved." said quietly under the fold reads as
 * nothing having happened at all.
 */
export default function StudioBrandingPanel({ unsavedRef, onNotice, onError }) {
  const [settings, setSettings] = useState(null);
  const [studioName, setStudioName] = useState("");
  // What the credentials email calls this system; see the field below.
  const [loginCredentialName, setLoginCredentialName] = useState("");
  const [galleryLogoUrl, setGalleryLogoUrl] = useState("");
  // One tab mark per tab theme. Each slot shows only what was uploaded into it: a light mark that
  // is standing in for the dark tab is not a dark mark, and showing it here would say it was.
  const [faviconUrl, setFaviconUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = (await getImageSelectionSettings())?.data || {};
      setSettings(next);
      setStudioName(next.studioName || "");
      setLoginCredentialName(next.loginCredentialName || "");
      setGalleryLogoUrl(next.galleryLogoUrl || "");
      setFaviconUrl(next.faviconUrl || "");
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Unable to load Global Logo settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Whether the form now differs from the record it read. Save is offered only while it does: an
  // untouched form has nothing to write, and a Save that could be pressed on one wrote an empty
  // name and no logo over the studio's - "Global Logo saved." with nothing saved.
  const dirty = hasBrandingChanges(settings, { studioName, loginCredentialName, galleryLogoUrl, faviconUrl });

  /*
   * What Settings asks before it lets this panel go.
   *
   * Closing the overlay or moving to another section throws an unsaved edit away, so the panel
   * that holds the edit is the one that has to say so. Cleared on the way out: a panel that is no
   * longer mounted is holding nothing, and a stale `true` would warn about an edit nobody made.
   */
  useEffect(() => {
    if (!unsavedRef) return undefined;
    unsavedRef.current = dirty;
    return () => { unsavedRef.current = false; };
  }, [dirty, unsavedRef]);


  async function save() {
    // This form carries the fields it does not edit - the gallery numbers and the two storage
    // paths - straight back to the API, so it may only save once it has actually read them. If the
    // read failed, the values it holds are empty defaults rather than the studio's, and saving
    // would write those over the record. Better to say so and offer the read again.
    if (!settings) {
      onError?.("These settings could not be read, so there is nothing safe to save yet. Reopen this page to try again.");
      return;
    }
    if (!dirty) return;

    const name = studioName.trim();
    // Decided before the save, from the edit itself: afterwards the record and the form agree, and
    // there would be nothing left to tell a name-only save from a logo-only one.
    const notice = brandingSavedNotice(settings, { studioName, loginCredentialName, galleryLogoUrl, faviconUrl });

    setSaving(true);
    setError("");
    try {
      // The API validates and saves its full settings record. Carrying the fields this panel does
      // not edit through unchanged prevents a branding update from resetting gallery defaults or
      // configured storage paths.
      const response = await saveImageSelectionSettings({
        galleryValidityMonths: Number(settings?.galleryValidityMonths ?? 6),
        defaultSelectionLimit: Number(settings?.defaultSelectionLimit ?? 50),
        originalStoragePath: settings?.originalStoragePath || null,
        selectedOutputPath: settings?.selectedOutputPath || null,
        studioName: name,
        loginCredentialName: loginCredentialName.trim() || null,
        galleryLogoUrl: galleryLogoUrl || null,
        faviconUrl: faviconUrl || null,
      });
      const saved = response?.data || {};
      setSettings(saved);
      setStudioName(saved.studioName || "");
      setLoginCredentialName(saved.loginCredentialName || "");
      setGalleryLogoUrl(saved.galleryLogoUrl || "");
      setFaviconUrl(saved.faviconUrl || "");
      // The top bar reads the branding once per page; hand it the saved values so the new mark
      // and name appear now rather than after a reload.
      // The top bar reads the branding once per page and `StudioFavicon` reads the same answer, so
      // handing both the saved values is what changes the mark and the tab on the spot - no reload.
      updateStudioBranding({
        studioName: saved.studioName || "",
        // Carried too, because the Login Credentials page reads its domain from this answer: a
        // domain saved here has to reach an onboarding already open, not wait for a reload.
        loginCredentialName: saved.loginCredentialName || null,
        galleryLogoUrl: saved.galleryLogoUrl || null,
        faviconUrl: saved.faviconUrl || null,
      });
      onNotice?.(notice);
    } catch (requestError) {
      onError?.(requestError.message || "Unable to save Global Logo settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="px-1 py-6 text-center text-sm text-slate-500">Loading Global Logo...</p>;

  // The rule itself, run on a stand-in name, so what is typed is checked by the thing that will use
  // it: a value that is not a domain shows the fallback here rather than on somebody's account.
  const loginEmailPreview = loginEmail("John Smith", loginCredentialName);

  return <div className="max-w-4xl space-y-5">
    <TextField
      label="Global Name"
      value={studioName}
      // A hint about what to type, not a name the application will use. Left empty, nothing is
      // written beside the logo at all - see `brandNameFor`.
      placeholder="Your studio name"
      maxLength={191}
      disabled={saving}
      error=""
      onChange={(event) => { setStudioName(event.target.value); setError(""); }}
    />
    {/* Two jobs, one answer. It is what a new employee is told they have been given access to — the
        subject and the body of the email carrying their username and first password — and it is the
        domain their login address is issued at, `john.smi@<this>`. A domain is what to type, since
        that is the half that has to be exact; the email reads it as the name of the system. Left
        empty, or typed as something that is not a domain, addresses fall back to the domain the
        application ships with and the email uses the name it ships with. See `loginEmailDomain`. */}
    <TextField
      label="Login Credential Name"
      value={loginCredentialName}
      placeholder={`Your login domain, e.g. ${FALLBACK_LOGIN_EMAIL_DOMAIN}`}
      maxLength={120}
      disabled={saving}
      error=""
      onChange={(event) => { setLoginCredentialName(event.target.value); setError(""); }}
    />
    {/* Said where it is typed rather than left to be discovered on an account: the address is built
        here, and the only place it is otherwise visible is the credentials page of an onboarding. */}
    <p className="-mt-3 text-[11px] text-slate-500">
      Employee logins are issued at this domain — {loginEmailPreview}. It also names this system in
      the email carrying those credentials.
    </p>
    <ImageUploadField
      label="Global Logo"
      value={galleryLogoUrl}
      disabled={saving}
      onChange={(value) => { setGalleryLogoUrl(value || ""); setError(""); }}
    />
    {/* The browser tab. One mark, worn on every tab whatever the browser's strip: an icon with a
        background of its own reads correctly either way. Left empty, the tab wears the bundled
        mark, which is the one thing here still drawn per theme. The file is sent exactly as it was
        picked: a favicon is a few kilobytes, and re-encoding it would only cost it its sharpness. */}
    <ImageUploadField
      label="Favicon"
      value={faviconUrl}
      disabled={saving}
      accept={FAVICON_ACCEPT}
      acceptLabel="PNG or SVG up to 5 MB. Shown on light and dark browser tabs."
      maxBytes={MAX_FAVICON_BYTES}
      rawTypes={["image/png"]}
      onChange={(value) => { setFaviconUrl(value || ""); setError(""); }}
    />
    {error && <p role="alert" className="text-xs text-red-600 sm:text-sm">{error}</p>}
    <div className="flex justify-end border-t border-slate-200 pt-4">
      <Button type="button" variant="primary" disabled={saving || !dirty} onClick={() => void save()}>
        {saving ? "Saving..." : "Save changes"}
      </Button>
    </div>
  </div>;
}
