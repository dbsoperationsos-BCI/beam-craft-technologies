"use client";

import { useRef, useState } from "react";
import UploadFileRow from "./UploadFileRow";

const ROW_HEIGHT = 46;
const VIEWPORT = 300;
const OVERSCAN = 6;

/**
 * The per-file list, windowed: ten thousand rows cost the same as fifteen. Only the rows in view
 * (plus a few either side) exist in the DOM; the rest is one tall spacer that keeps the scrollbar
 * honest. Rows keep their picked order, so the active ones move down the list as the batch runs.
 */
export default function UploadFileList({ items }) {
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef(null);
  const total = items.length;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(total, Math.ceil((scrollTop + VIEWPORT) / ROW_HEIGHT) + OVERSCAN);
  const visible = items.slice(first, last);
  return <div ref={ref} tabIndex={0} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} className="overflow-y-auto rounded-lg border border-slate-200 bg-white focus-visible:outline-2 focus-visible:outline-blue-500" style={{ maxHeight: VIEWPORT }} role="list" aria-label="Files in this upload">
    <div style={{ height: total * ROW_HEIGHT, position: "relative" }}>
      {visible.map((item, index) => <div key={item.id} role="listitem" style={{ position: "absolute", top: (first + index) * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }}>
        <UploadFileRow item={item} style={{ height: ROW_HEIGHT }} />
      </div>)}
    </div>
  </div>;
}
