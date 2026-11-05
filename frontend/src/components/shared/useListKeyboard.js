"use client";

import { useEffect, useState } from "react";

/**
 * Walking a menu's options with the keyboard, for the controls that open a list of them.
 *
 * The two column filters - `FilterMultiSelect` and `FilterCombobox` - ask the same question of the
 * arrow keys and answered it in the same thirty-five lines twice, which is how they had already
 * drifted apart on when the walk is forgotten. One rule here instead, and each control keeps only
 * the part that genuinely differs: what **Enter** means, which is a different thing to a filter
 * taking several answers than to one taking a single answer.
 *
 * ── What it owns ──
 *
 * `activeIndex` is which row the keyboard is on, as an index into the options **currently shown** -
 * the narrowed list, so it is walked as it reads rather than as it was before the search. `-1` is
 * "none yet", which is what makes the first ArrowDown land on the first row and the first ArrowUp
 * on the last, and what Enter checks before acting: a list nobody has walked has no highlighted
 * option, and Enter over it must do nothing rather than take whichever happened to be first.
 *
 * An index rather than a value, because two options may share a label and the list is rebuilt on
 * every keystroke. The caller resets it to `-1` whenever the list narrows or the menu closes; that
 * cannot be done from an effect here without writing state during one, which this codebase keeps
 * out of components.
 *
 * `walk` handles Down, Up, Home and End and says whether it took the key, so the caller can hand it
 * every keystroke and then deal with what is left. Down and Up wrap at either end, so a list can be
 * walked round rather than stopping dead.
 *
 * ── Home and End wait for the walk ──
 *
 * Both are claimed only once `activeIndex` is on a row. Focus in both controls sits in a **text
 * box** - the search box in one, the filter field itself in the other - where Home and End move the
 * caret, and a menu that took them outright would stop somebody reaching the start of what they
 * were typing. Taken unconditionally at first, which is exactly that bug.
 *
 * ── Keeping the highlight in view ──
 *
 * A list of forty values scrolls, and arrows that move a highlight nobody can see are arrows that
 * do nothing. `nearest` so a row already on screen does not jolt the list to centre it. `listRef`
 * is the scrolling element whose children are the option rows one-for-one, which is why the index
 * is enough and no ref per row is needed.
 */
export default function useListKeyboard({ count = 0, listRef }) {
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (activeIndex < 0) return;
    listRef?.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listRef]);

  /** Takes the key if it is one of the four this owns, and says so. */
  function walk(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!count) return true;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const next = current + step;
        if (next < 0) return count - 1;
        if (next >= count) return 0;
        return next;
      });
      return true;
    }
    if ((event.key === "Home" || event.key === "End") && activeIndex >= 0 && count) {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : count - 1);
      return true;
    }
    return false;
  }

  return { activeIndex, setActiveIndex, walk };
}
