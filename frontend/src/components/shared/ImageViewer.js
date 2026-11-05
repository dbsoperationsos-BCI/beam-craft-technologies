"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import OpenInNew from "@mui/icons-material/OpenInNew";
import IconButton from "@/components/shared/IconButton";
import Lightbox from "@/components/shared/Lightbox";

/**
 * Any picture in the application, opened full screen - the one image viewer, Google-style: the
 * dark layer over the page, the picture at its own ratio, previous and next through the pictures it
 * was opened among, "2 of 5", Escape to close, and the original a press away.
 *
 * Mounted once in the shell (`ImageViewerProvider`), and reached from anywhere a picture is drawn:
 *
 *   const openImages = useImageViewer();
 *   <button onClick={() => openImages(urls, index)}><img src={urls[index]} /></button>
 *
 * `images` is a list of URLs or `{ src, name }`. It is drawn by the shared `Lightbox` on its own
 * layer (`imageViewer`), over every form panel, dialog and popover it can be opened from, so a
 * bill opened from inside a payment request's panel sits over that panel rather than behind it.
 *
 * Outside the shell (a public page) there is no provider, and `useImageViewer` answers `null`: the
 * shared image components then draw their pictures exactly as before, not as buttons that do
 * nothing.
 */

const ImageViewerContext = createContext(null);

const asImage = (image, index) => (typeof image === "string"
  ? { src: image, name: "" }
  : { src: image?.src || image?.url || "", name: image?.name || image?.fileName || "" });

export function ImageViewerProvider({ children }) {
  const [state, setState] = useState(null);
  const openImages = useCallback((images, index = 0) => {
    const list = (Array.isArray(images) ? images : [images]).map(asImage).filter((image) => image.src);
    if (!list.length) return;
    setState({ list, index: Math.min(Math.max(0, index), list.length - 1) });
  }, []);
  const close = useCallback(() => setState(null), []);
  const current = state?.list[state.index];

  return <ImageViewerContext.Provider value={openImages}>
    {children}
    {current && <Lightbox
      src={current.src}
      alt={current.name || (state.list.length > 1 ? `Image ${state.index + 1}` : "Image")}
      title={current.name || undefined}
      caption={state.list.length > 1 ? `${state.index + 1} of ${state.list.length}` : undefined}
      layer="imageViewer"
      onClose={close}
      hasPrev={state.index > 0}
      hasNext={state.index < state.list.length - 1}
      onPrev={() => setState((value) => ({ ...value, index: Math.max(0, value.index - 1) }))}
      onNext={() => setState((value) => ({ ...value, index: Math.min(value.list.length - 1, value.index + 1) }))}
      corner={<IconButton
        label="Open the original in a new tab"
        variant="plain"
        shape="circle"
        size="sm"
        className="bg-white/90 text-slate-700 shadow-sm"
        onClick={() => window.open(current.src, "_blank", "noopener,noreferrer")}
      ><OpenInNew style={{ fontSize: 18 }} /></IconButton>}
    />}
  </ImageViewerContext.Provider>;
}

/** `(images, index) => void` to open the viewer, or `null` where no viewer is mounted. */
export function useImageViewer() {
  return useContext(ImageViewerContext);
}

/**
 * A picture that opens the viewer when pressed - the wrapper the shared image components use, so
 * the press, the focus ring and the label are the same everywhere. Without a viewer (outside the
 * shell) it renders its children as they are.
 */
export function ViewableImage({ images, index = 0, label = "View image", className = "", children }) {
  const openImages = useImageViewer();
  if (!openImages) return children;
  return <button
    type="button"
    aria-label={label}
    title={label}
    onClick={(event) => { event.stopPropagation(); openImages(images, index); }}
    className={`block cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${className}`}
  >{children}</button>;
}
