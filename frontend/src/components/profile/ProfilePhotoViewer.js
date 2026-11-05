"use client";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import Image from "next/image";
import { useEffect, useState } from "react";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";
import downloadImage from "@/lib/downloadImage";
import { downloadMyProfilePhoto } from "@/services/user/profile.service";
import useEscapeKey from "@/components/shared/useEscapeKey";

/**
 * Whether this is a device that can be pointed at something.
 *
 * "Take photo" is offered on a phone and not on a desk, and the honest test for that is the
 * pointer: a coarse one means a finger, which means a camera worth offering. A window narrowed to
 * phone width on a laptop is still a laptop, which is why this asks about the pointer rather than
 * about the width the rest of the app lays itself out by.
 */
function useHasCamera() {
  const [hasCamera, setHasCamera] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const read = () => setHasCamera(coarse.matches);
    read();
    coarse.addEventListener("change", read);
    return () => coarse.removeEventListener("change", read);
  }, []);
  return hasCamera;
}

/**
 * The photo on its own screen, opened by pressing the avatar on My Profile.
 *
 * Everything that can be done to a photo is in the one menu at the top right rather than scattered
 * around the page: change it, save a copy, remove it. Changing asks where the new one comes from,
 * and on a phone that includes the camera.
 *
 * The picking itself belongs to the page, not here — the file inputs, the size limit and the
 * compression are already written there and are the same whichever control opened them, so this
 * screen only says which one was asked for.
 */
export default function ProfilePhotoViewer({ photo, name, busy, onClose, onChooseFromGallery, onTakePhoto, onRemove }) {
  const hasCamera = useHasCamera();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEscapeKey(onClose);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setStatus("");
    setError("");
    try {
      await downloadImage(photo, name, downloadMyProfilePhoto);
      setStatus("Photo downloaded.");
    } catch (downloadError) {
      setError(downloadError.message || "Unable to download this photo.");
    } finally {
      setSaving(false);
    }
  }

  const changeSubmenu = [
    ...(hasCamera ? [{ label: "Take photo", onSelect: onTakePhoto }] : []),
    { label: "Choose from gallery", onSelect: onChooseFromGallery },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${name}'s profile photo`}
      className={`fixed inset-0 ${layers.dialog} flex flex-col bg-white`}
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-2 sm:h-14 sm:px-4">
        <button type="button" onClick={onClose} aria-label="Close photo" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-slate-100">
          <ArrowBackRoundedIcon fontSize="small" aria-hidden="true" />
        </button>
        <p className="min-w-0 truncate text-sm font-medium text-slate-700">{name}</p>
        <OptionsMenu
          ariaLabel="Photo options"
          menuClassName="w-52"
          // The menu hangs off a screen that already sits at the dialog layer, so it needs the one
          // above it or it would open underneath the photo it belongs to.
          menuZIndexClassName={layers.menuOverPanel}
          items={[
            { label: "Change photo", submenu: changeSubmenu },
            { label: saving ? "Downloading..." : "Download photo", disabled: saving, onSelect: () => void save() },
            { separator: true },
            { label: "Remove photo", tone: "danger", disabled: busy, onSelect: onRemove },
          ]}
        />
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-50 p-3 sm:p-6">
        <Image
          src={photo}
          alt={`${name}'s profile photo`}
          width={960}
          height={960}
          unoptimized
          style={{ maxHeight: "100%", width: "auto", height: "auto" }}
          className="max-h-full w-auto rounded-lg object-contain shadow-sm"
        />
      </div>

      {(status || error || busy) && (
        <footer className="shrink-0 border-t border-slate-200 px-4 py-3 text-center text-xs sm:text-sm">
          {busy && <span className="text-slate-500">Saving photo...</span>}
          {!busy && error && <span role="alert" className="text-red-600">{error}</span>}
          {!busy && !error && status && <span className="text-slate-600">{status}</span>}
        </footer>
      )}
    </div>
  );
}
