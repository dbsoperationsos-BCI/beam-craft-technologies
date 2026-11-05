"use client";

import { useEffect, useState } from "react";
import { drawWatermarkText } from "@/services/ai-feature/watermark-presets.service";

// One drawing per text, colour and weight for the life of the page: the grid of presets and an open
// dialog ask for the same ones.
const drawn = new Map();

/**
 * The server's own drawing of a text mark - `{ src, width, height }`, or null while it is drawn -
 * asked for a moment after typing stops, so the preview shows exactly the letters guests get.
 */
export default function useTextMark({ text, textColor, fontWeight }, enabled = true) {
  const key = enabled && text?.trim() && /^#[0-9a-fA-F]{6}$/.test(textColor || "") ? JSON.stringify([text.trim(), textColor.toUpperCase(), fontWeight || "BOLD"]) : null;
  const [state, setState] = useState({ key: null, mark: null, error: "" });
  useEffect(() => {
    if (!key || drawn.has(key)) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const [words, colour, weight] = JSON.parse(key);
      try {
        const data = (await drawWatermarkText({ text: words, textColor: colour, fontWeight: weight }))?.data;
        const mark = { src: data.dataUrl, width: data.width, height: data.height };
        drawn.set(key, mark);
        if (drawn.size > 50) drawn.delete(drawn.keys().next().value);
        if (!cancelled) setState({ key, mark, error: "" });
      } catch (cause) {
        if (!cancelled) setState({ key, mark: null, error: cause?.message || "The text could not be drawn." });
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [key]);
  if (!key) return { mark: null, error: "" };
  if (drawn.has(key)) return { mark: drawn.get(key), error: "" };
  return state.key === key ? { mark: state.mark, error: state.error } : { mark: null, error: "" };
}
