"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./marketing.module.css";

/**
 * Fades its children up the first time they scroll into view.
 *
 * CSS does the motion and an IntersectionObserver only flips a class, so the home page carries no
 * animation library. `delay` is in seconds. Reduced motion is honoured in the stylesheet: the
 * content is simply there.
 */
export default function Reveal({ children, delay = 0, className = "", as: Tag = "div" }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    // Without an observer there is nothing to wait for - show the content rather than hide it.
    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "0px 0px -60px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`${styles.reveal} ${visible ? styles.revealed : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}s` } : undefined}
    >
      {children}
    </Tag>
  );
}
