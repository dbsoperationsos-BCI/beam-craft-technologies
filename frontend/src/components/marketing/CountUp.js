"use client";

import { useEffect, useRef, useState } from "react";

const easeOutCubic = (progress) => 1 - Math.pow(1 - progress, 3);

/**
 * A number that counts up to `value` once it is on screen. With reduced motion, or no observer, it
 * shows the final number straight away.
 */
export default function CountUp({ value, duration = 1600, decimals = 0, suffix = "" }) {
  const ref = useRef(null);
  const target = Number(value) || 0;
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const node = ref.current;
    let frame;
    if (!node || typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      frame = requestAnimationFrame(() => setDisplay(target));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const start = performance.now();
      const tick = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        setDisplay(target * easeOutCubic(progress));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [target, duration]);

  return (
    <span ref={ref}>
      {display.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}
