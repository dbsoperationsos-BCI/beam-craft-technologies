"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import ImageUploadField from "@/components/shared/ImageUploadField";
import { updateStudioBranding } from "@/components/shared/useStudioBranding";
import { haveSlidesChanged } from "@/lib/studioBranding.mjs";
import { getClientPageImages, getImageSelectionSettings, saveClientPageImages, saveImageSelectionSettings } from "@/services/image-selection/image-selection.service";

/** How many pictures the login page will turn through. Enough for a story, few enough to load fast. */
export const MAX_LOGIN_SLIDES = 5;
/** How many the client sign-in's film strip carries - a strip wants a few more frames than a slide show. */
export const MAX_CLIENT_PAGE_IMAGES = 8;

// The stored JSON predates this panel and may contain blank/non-string values left by an earlier
// version. Keep that legacy data from making an otherwise valid Login Slide save fail validation.
const normalizeSlides = (value, max) => (Array.isArray(value) ? value : [])
  .filter((slide) => typeof slide === "string")
  .map((slide) => slide.trim())
  .filter(Boolean)
  .slice(0, max);

// Where each list is read from and written to. Module-level, so the panel's load keeps one identity.
const readLoginSlides = async () => (await getImageSelectionSettings())?.data || {};
const writeLoginSlides = async (loginSlides) => (await saveImageSelectionSettings({ loginSlides }))?.data || {};
const readClientPageImages = async () => (await getClientPageImages())?.data || {};
const writeClientPageImages = async (slides) => (await saveClientPageImages(slides))?.data || {};

/**
 * The pictures the login page turns through beside the sign-in form - "Login Slide" in Settings.
 *
 * They live on the same studio-wide settings record as the Global Logo, because they are the same
 * kind of thing: one answer for the whole application, set by an administrator, read by a public
 * page through the same public branding endpoint the logo uses. Each slide is either an existing
 * https link, echoed back untouched, or a freshly picked image as a data URI, which the server
 * compresses and uploads the way it does the logo.
 *
 * Saving sends only the slides: the API leaves out-of-request fields alone, so a change here can
 * never reset gallery defaults, storage paths or the logo, and those forms cannot reset this.
 *
 * The same panel keeps the client sign-in page's pictures (`ClientPageImagesPanel` below): another
 * list on the same record, through an endpoint and a permission of its own, named by `field`.
 */
export default function LoginSlidePanel({
  unsavedRef,
  field = "loginSlides",
  name = "Login Slide",
  itemLabel = "Slide",
  max = MAX_LOGIN_SLIDES,
  description = `The pictures shown beside the sign-in form, turned through one after another. Up to ${MAX_LOGIN_SLIDES}; with none, the page shows its plain slides.`,
  read = readLoginSlides,
  write = writeLoginSlides,
}) {
  const [slides, setSlides] = useState([]);
  // The list as last read or saved, so the form can tell an edit from having merely been opened.
  // Null until the read succeeds: a form holding empty defaults has nothing safe to write.
  const [savedSlides, setSavedSlides] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await read();
      const stored = normalizeSlides(next[field], max);
      setSlides(stored);
      setSavedSlides(stored);
      setError("");
    } catch (requestError) {
      setError(requestError.message || `Unable to load ${name}.`);
    } finally {
      setLoading(false);
    }
  }, [read, field, max, name]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function setSlide(index, value) {
    setError("");
    setNotice("");
    setSlides((current) => {
      const next = [...current];
      if (value) next[index] = value;
      else next.splice(index, 1);
      return next;
    });
  }

  // Save is offered only while the pictures differ from what is stored. An untouched form has
  // nothing to write, and a Save that could be pressed on one reported "Login Slide saved." for a
  // save that changed nothing.
  const dirty = haveSlidesChanged(savedSlides, normalizeSlides(slides, max));

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
    if (!dirty) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await write(normalizeSlides(slides, max));
      const stored = normalizeSlides(saved[field], max);
      setSlides(stored);
      setSavedSlides(stored);
      // The sign-in page reads the same branding record; hand it the saved list too.
      updateStudioBranding({ [field]: stored });
      setNotice(`${name} saved.`);
    } catch (requestError) {
      setError(requestError.message || `Unable to save ${name}.`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="px-1 py-6 text-center text-sm text-slate-500">Loading {name}...</p>;

  // One field per slide, and one empty field after the last while there is room for another: the
  // list grows by filling the empty one and shrinks by removing a photo, with no add button to find.
  const fields = slides.length < max ? [...slides, ""] : slides;

  return <div className="max-w-4xl space-y-5">
    <div className="grid gap-5 md:grid-cols-2">
      {fields.map((slide, index) => (
        <ImageUploadField
          key={`slide-${index}`}
          label={`${itemLabel} ${index + 1}`}
          // The panel has no heading of its own, so what the pictures are for rides on the first
          // picture's ⓘ rather than as a line above them.
          helperText={index === 0 ? `${description} This one is shown first; the rest follow in this order.` : ""}
          value={slide}
          disabled={saving}
          onChange={(value) => setSlide(index, value || "")}
        />
      ))}
    </div>
    {error && <p role="alert" className="text-xs text-red-600 sm:text-sm">{error}</p>}
    {notice && <p role="status" className="text-xs text-emerald-700 sm:text-sm">{notice}</p>}
    <div className="flex justify-end border-t border-slate-200 pt-4">
      <Button type="button" variant="primary" disabled={saving || !dirty} onClick={() => void save()}>
        {saving ? "Saving..." : "Save changes"}
      </Button>
    </div>
  </div>;
}

/**
 * Settings → Project Management → Client page images: the pictures on the film strip of the client
 * sign-in page (`/client/login`), kept apart from the staff sign-in's Login Slide pictures.
 */
export function ClientPageImagesPanel({ unsavedRef }) {
  return <LoginSlidePanel
    unsavedRef={unsavedRef}
    field="clientLoginSlides"
    name="Client page images"
    itemLabel="Picture"
    max={MAX_CLIENT_PAGE_IMAGES}
    description={`The pictures on the strip of film drifting past on the client sign-in page, in this order. Up to ${MAX_CLIENT_PAGE_IMAGES}; landscape pictures work best, as each is cropped to fit its frame. With none, the strip shows plain frames in the studio's colours.`}
    read={readClientPageImages}
    write={writeClientPageImages}
  />;
}
