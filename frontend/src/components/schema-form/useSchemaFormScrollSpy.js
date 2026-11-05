"use client";

import { useCallback, useEffect, useRef } from "react";
import { scrollToSchemaSection } from "./scrollToSchemaSection";

const MOBILE_STICKY_SECTION_OFFSET = 49;
/** How far past the top of the reading area a section must be before it counts as the one being read. */
const ACTIVE_SECTION_THRESHOLD = 12;
/** Slack for the bottom of the scroll, where fractional heights stop the numbers matching exactly. */
const BOTTOM_TOLERANCE = 2;

function getStickyOffset() {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches ? 0 : MOBILE_STICKY_SECTION_OFFSET;
}

/**
 * Keeps the sidebar pointing at the section being read.
 *
 * The sections are read from the DOM rather than from a list passed in, so a form whose sections
 * depend on its answers cannot leave the spy following headings that are no longer on screen.
 *
 * The scroll position is the only thing that decides the highlight. Clicking a section scrolls to
 * it and the highlight follows that scroll like any other, which is what keeps the sidebar honest:
 * there is no state that can survive a scroll and leave it pointing at something else.
 */
export default function useSchemaFormScrollSpy(contentRef, onActiveSectionChange) {
  const frameRef = useRef(0);

  const updateEndSpacer = useCallback(() => {
    const scrollContainer = contentRef.current;
    if (!scrollContainer) return;

    const sections = scrollContainer.querySelectorAll("[data-schema-section]");
    const lastSection = sections[sections.length - 1];
    const endSpacer = scrollContainer.querySelector("[data-schema-form-end-spacer]");
    if (!lastSection || !endSpacer) return;

    // Enough room below the last section for it to reach the top of the reading area, so it can
    // become the active section like any other.
    const requiredSpace = Math.max(0, scrollContainer.clientHeight - lastSection.offsetHeight - getStickyOffset() + ACTIVE_SECTION_THRESHOLD);
    endSpacer.style.height = `${Math.ceil(requiredSpace)}px`;
  }, [contentRef]);

  const updateActiveSection = useCallback(() => {
    const scrollContainer = contentRef.current;
    if (!scrollContainer) return;

    const sections = Array.from(scrollContainer.querySelectorAll("[data-schema-section]"));
    if (!sections.length) return;

    // The end of the form always reads as its last section, however short that one is.
    const atBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - BOTTOM_TOLERANCE;
    if (atBottom) {
      onActiveSectionChange(sections[sections.length - 1].dataset.schemaSection);
      return;
    }

    const containerTop = scrollContainer.getBoundingClientRect().top;
    const readingLine = scrollContainer.scrollTop + getStickyOffset() + ACTIVE_SECTION_THRESHOLD;
    let active = sections[0].dataset.schemaSection;
    sections.forEach((section) => {
      const sectionTop = scrollContainer.scrollTop + section.getBoundingClientRect().top - containerTop;
      if (sectionTop <= readingLine) active = section.dataset.schemaSection;
    });

    onActiveSectionChange(active);
  }, [contentRef, onActiveSectionChange]);

  const scheduleUpdate = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      updateActiveSection();
    });
  }, [updateActiveSection]);

  useEffect(() => {
    const scrollContainer = contentRef.current;
    if (!scrollContainer) return undefined;

    const handleResize = () => {
      updateEndSpacer();
      scheduleUpdate();
    };

    scrollContainer.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", handleResize);
    updateEndSpacer();
    scheduleUpdate();

    return () => {
      scrollContainer.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", handleResize);
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [contentRef, scheduleUpdate, updateEndSpacer]);

  const selectSection = useCallback((sectionId) => {
    const scrollContainer = contentRef.current;
    if (!scrollContainer) return;

    onActiveSectionChange(sectionId);
    updateEndSpacer();
    scrollToSchemaSection(scrollContainer, sectionId);
  }, [contentRef, onActiveSectionChange, updateEndSpacer]);

  return { selectSection, onContentScroll: scheduleUpdate };
}
