const MOBILE_STICKY_SECTION_OFFSET = 49;

export function scrollToSchemaSection(scrollContainer, sectionId) {
  if (!scrollContainer) return;

  const section = scrollContainer.querySelector(`[data-schema-section="${sectionId}"]`);
  if (!section) return;

  const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
  const stickyOffset = isDesktop ? 0 : MOBILE_STICKY_SECTION_OFFSET;
  const containerRect = scrollContainer.getBoundingClientRect();
  const sectionRect = section.getBoundingClientRect();
  const targetTop = scrollContainer.scrollTop + sectionRect.top - containerRect.top - stickyOffset;

  scrollContainer.scrollTo({
    top: Math.max(0, targetTop),
    behavior: "smooth",
  });
}
