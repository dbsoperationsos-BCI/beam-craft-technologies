"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import { firstPermittedRoute } from "@/constants/modulePermissions";
import { initialsOf } from "@/lib/initials";
import { profileReturnTo } from "@/lib/profileReturn";
import EmployeeOrgChart from "@/components/employees/EmployeeOrgChart";
import ProfilePhotoViewer from "@/components/profile/ProfilePhotoViewer";
import OnboardingDetailsView from "@/components/profile/OnboardingDetailsView";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import TextField from "@/components/shared/TextField";
import { PageLoader } from "@/components/shared/Loader";
import Tabs from "@/components/ui/Tabs";
import { compressImageFile } from "@/lib/imageCompression";
import { changeMyPassword, getMyOrgChart, getMyProfile, updateMyProfilePhoto } from "@/services/user/profile.service";
import { announceProfilePhotoChanged } from "@/lib/profilePhoto";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_LABEL = "JPG, PNG, WEBP, AVIF, or GIF up to 5 MB.";
// The courtesy copy of the policy `backend/src/services/passwordPolicy.js` enforces — that check
// is the gate; this line only tells somebody what to type before the server has to refuse it.
const PASSWORD_HINT = "At least 8 characters, with an upper and a lower case letter, a number, and a special character. Not one of your recent passwords.";

function CameraIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175 7.9 4.566A1.5 1.5 0 0 1 9.148 3.9h5.704a1.5 1.5 0 0 1 1.248.666l1.073 1.609A1.5 1.5 0 0 0 18.42 6.84H19.5A2.5 2.5 0 0 1 22 9.34v8.16a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5V9.34a2.5 2.5 0 0 1 2.5-2.5h1.079a1.5 1.5 0 0 0 1.248-.665Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function MailIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5 shrink-0"><rect x="3" y="5" width="18" height="14" rx="2" /><path strokeLinecap="round" d="m4 7 8 6 8-6" /></svg>;
}

function PhoneIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 5.5c0-1.1.9-2 2-2h2l1.6 4-2 1.5a12.5 12.5 0 0 0 6.9 6.9l1.5-2 4 1.6v2c0 1.1-.9 2-2 2A16.5 16.5 0 0 1 4.5 5.5Z" /></svg>;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

/**
 * One's own password, changed on the strength of knowing the current one. Only the match between
 * the two new fields is checked here — the policy itself is the server's answer, and it names the
 * first rule the password fails.
 */
function ChangePassword({ onChanged }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await changeMyPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onChanged();
    } catch (requestError) {
      setError(requestError.message || "Unable to change your password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-lg space-y-4">
      <TextField label="Current Password" required type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" />
      <div>
        <TextField label="New Password" required type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" />
        <p className="mt-1.5 text-xs text-slate-500">{PASSWORD_HINT}</p>
      </div>
      <TextField label="Confirm New Password" required type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
      {error && <p role="alert" className="text-xs text-red-600 sm:text-sm">{error}</p>}
      <Button type="submit" variant="primary" disabled={saving}>{saving ? "Changing..." : "Change Password"}</Button>
    </form>
  );
}

/**
 * My Profile - the signed-in person's own page, reached from the user menu.
 *
 * One card: the header says who they are - photo, name, email, contact - and the tab bar under it
 * holds what they can do about it: My Details, Change Password, and (for a login with an employee
 * record) the Org Chart, drawn by the same component the Employee Repository uses, fed by the
 * self-service route every signed-in person may read.
 *
 * **My Details is the onboarding record**, the whole of it, drawn from the onboarding form's own
 * section list. It used to be eleven assorted facts in read-only text boxes - a summary rather
 * than a record, which left the one place somebody could check what the studio holds about them
 * showing a tenth of it, and asked them to read a row of boxes they could not type in.
 *
 * The photo saves as it is picked - there is no form around it to submit, and a picked photo left
 * unsaved behind a Back button is a photo lost. It lands on the linked employee record where one
 * exists - the same field HR sets from the employee form - and on the login itself otherwise, so
 * the standalone Super Admin has one too.
 */
export default function ProfilePage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const inputId = useId();
  const cameraInputId = useId();
  // The two file inputs the photo menu reaches: one for the gallery, one for the camera. Held as
  // refs so the viewer can ask for either without a second copy of the picking code.
  const galleryInput = useRef(null);
  const cameraInput = useRef(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [tab, setTab] = useState("personal");
  const [viewingPhoto, setViewingPhoto] = useState(false);
  const { notice, showSuccess, clearNotice } = useNotice();

  useEffect(() => {
    let cancelled = false;
    getMyProfile()
      .then((response) => { if (!cancelled) setProfile(response?.data || null); })
      .catch((requestError) => { if (!cancelled) setPhotoError(requestError.message || "Unable to load your profile."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function savePhoto(nextPhoto) {
    setSavingPhoto(true);
    setPhotoError("");
    try {
      const response = await updateMyProfilePhoto(nextPhoto);
      const savedPhoto = response?.data?.profilePhotoUrl || null;
      setProfile((current) => ({ ...current, profilePhotoUrl: savedPhoto }));
      announceProfilePhotoChanged(savedPhoto);
    } catch (requestError) {
      setPhotoError(requestError.message || "Unable to save your photo.");
    } finally {
      setSavingPhoto(false);
    }
  }

  async function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setPhotoError(`That image is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Choose one of 5 MB or less.`);
      return;
    }
    setPhotoError("");
    try {
      // Resampled on this machine before it travels, the way every photo in the OS is.
      const compressed = await compressImageFile(file);
      await savePhoto(compressed.dataUrl);
    } catch {
      setPhotoError("Unable to read the selected image — it may be damaged, or in a format this browser cannot open.");
    }
  }

  const photo = profile?.profilePhotoUrl;
  // Org Chart is offered to everyone: a login with an employee record opens the chart at
  // themselves, one without (the standalone Super Admin) opens it at the top of the studio and
  // walks it the same way the Employee Repository's record view does.
  const tabs = [
    { id: "personal", label: "My Details" },
    { id: "password", label: "Change Password" },
    { id: "org-chart", label: "Org Chart" },
  ];

  return (
    // The page is the surface, not a card floating on one: white edge to edge like every other
    // module screen, so the profile reads as a place rather than a pop-up.
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col bg-white">
      {/* Back to the page My Profile was chosen from. Opened with no page before it - a bookmark, a
          reload - it falls to the first screen this role may open, as the top bar's controls do. */}
      <ModulePageHeader title="My Profile" onBack={() => router.push(profileReturnTo() || firstPermittedRoute(hasPermission) || "/sales/crm")} />
      <FloatingNotice notice={notice} onClose={clearNotice} />
      {loading ? (
        <div className="flex-1 px-4 py-6"><PageLoader label="Loading your profile..." /></div>
      ) : !profile ? (
        <p role="alert" className="px-4 py-6 text-sm text-red-600 sm:px-8">{photoError || "Unable to load your profile."}</p>
      ) : (
        <>
            {/* Who they are: the header every tab below acts on. */}
            <div className="flex flex-col items-center gap-5 border-b border-slate-100 px-4 pb-6 pt-6 text-center sm:flex-row sm:items-center sm:gap-6 sm:px-8 sm:text-left">
              <div className="relative w-fit shrink-0">
                {photo ? (
                  // The photo is the way into its own screen, which is where it can be saved or
                  // changed. A plain image would look like the only thing on offer.
                  <button type="button" onClick={() => setViewingPhoto(true)} aria-label="View profile photo" className="block rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
                    <Image src={photo} alt={`${profile.name}'s profile photo`} width={96} height={96} unoptimized className="h-24 w-24 rounded-full border border-slate-200 object-cover" />
                  </button>
                ) : (
                  <div aria-hidden="true" className="flex h-24 w-24 items-center justify-center rounded-full bg-indigo-100 text-3xl font-bold text-indigo-700">
                    {initialsOf(profile.name)}
                  </div>
                )}
                {/* The camera badge every avatar editor wears: the whole affordance in one glance,
                    sitting on the photo it changes. Saves as it is picked. */}
                <label
                  htmlFor={inputId}
                  aria-label={photo ? "Replace profile photo" : "Add profile photo"}
                  title={ACCEPTED_LABEL}
                  className={`absolute bottom-0 right-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900 ${savingPhoto ? "pointer-events-none opacity-60" : ""}`}
                >
                  <CameraIcon />
                </label>
                <input ref={galleryInput} id={inputId} type="file" accept="image/*" disabled={savingPhoto} onChange={(event) => void pick(event)} className="sr-only" />
                {/* `capture` asks a phone for its camera rather than its gallery. Offered only
                    through the photo menu, which decides whether this is a device with one. */}
                <input ref={cameraInput} id={cameraInputId} type="file" accept="image/*" capture="environment" disabled={savingPhoto} onChange={(event) => void pick(event)} className="sr-only" />
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold text-slate-900">{profile.name}</h2>
                {profile.username && <p className="truncate text-xs text-slate-400">@{profile.username}</p>}
                <div className="mt-2 flex flex-col items-center gap-1 text-sm text-slate-600 sm:items-start">
                  <span className="flex min-w-0 items-center gap-1.5"><MailIcon /><span className="truncate">{profile.email}</span></span>
                  {profile.contactNumber && <span className="flex min-w-0 items-center gap-1.5"><PhoneIcon /><span className="truncate">{profile.contactNumber}</span></span>}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                  {photo && (
                    <button type="button" disabled={savingPhoto} onClick={() => void savePhoto(null)} className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-60">
                      Remove photo
                    </button>
                  )}
                  {savingPhoto && <span className="text-xs text-slate-500">Saving...</span>}
                </div>
                {photoError && <p role="alert" className="mt-2 text-xs text-red-600">{photoError}</p>}
              </div>
            </div>

            {/* The bar under the header: what can be done about the person above it. */}
            <div className="border-b border-slate-200 px-4 sm:px-8">
              <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Profile sections" />
            </div>

            {/* The pane below the bar scrolls on its own, so a tall org chart never carries the
                header and the tabs off the top of the screen. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
              {tab === "personal" && (
                <OnboardingDetailsView onboarding={profile.onboarding} />
              )}
              {tab === "password" && (
                <ChangePassword onChanged={() => showSuccess("Password changed. Use the new one next time you sign in.")} />
              )}
              {tab === "org-chart" && (
                <EmployeeOrgChart employeeId={profile.employeeId || null} employeeName={profile.employeeId ? profile.name : "the top"} fetchChart={getMyOrgChart} />
              )}
            </div>
        </>
      )}
      {viewingPhoto && photo && (
        <ProfilePhotoViewer
          photo={photo}
          name={profile.name}
          busy={savingPhoto}
          onClose={() => setViewingPhoto(false)}
          onChooseFromGallery={() => { if (!savingPhoto) galleryInput.current?.click(); }}
          onTakePhoto={() => { if (!savingPhoto) cameraInput.current?.click(); }}
          onRemove={() => {
            if (savingPhoto) return;
            // The screen is the photo; with the photo gone there is nothing left on it to look at.
            setViewingPhoto(false);
            void savePhoto(null);
          }}
        />
      )}
    </section>
  );
}
