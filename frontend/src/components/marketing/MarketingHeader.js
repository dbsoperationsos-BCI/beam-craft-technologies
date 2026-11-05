"use client";

import Link from "next/link";
import { useState } from "react";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import MarketingLogo from "./MarketingLogo";
import { CONTACT_HREF, HERO, NAV, SIGN_IN_HREF } from "./homeContent";

/**
 * The home page's fixed bar: the section links, and Sign in - the one way from here into the
 * application, which opens `/login`. Below `md` the links fold into a menu.
 */
export default function MarketingHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-mk-border/60 bg-mk-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-5">
        <MarketingLogo />

        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="text-sm text-mk-muted-foreground transition-colors hover:text-mk-foreground">{item.label}</a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link href={SIGN_IN_HREF} className="text-sm font-medium text-mk-muted-foreground transition-colors hover:text-mk-foreground">Sign in</Link>
          <a href={CONTACT_HREF} className="rounded-lg bg-mk-primary px-4 py-2 text-sm font-semibold text-mk-primary-foreground transition-all hover:brightness-110 active:scale-[0.98]">{HERO.primaryCta}</a>
        </div>

        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg border border-mk-border md:hidden" onClick={() => setOpen((value) => !value)} aria-label="Toggle menu" aria-expanded={open}>
          {open ? <CloseRoundedIcon sx={{ fontSize: 20 }} /> : <MenuRoundedIcon sx={{ fontSize: 20 }} />}
        </button>
      </div>

      {open && (
        <div className="border-t border-mk-border bg-mk-background px-4 py-4 md:hidden">
          <nav className="flex flex-col gap-3">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setOpen(false)} className="py-1.5 text-sm text-mk-muted-foreground">{item.label}</a>
            ))}
            <Link href={SIGN_IN_HREF} className="mt-2 rounded-lg bg-mk-primary px-4 py-2.5 text-center text-sm font-semibold text-mk-primary-foreground">Sign in</Link>
            <a href={CONTACT_HREF} onClick={() => setOpen(false)} className="py-1.5 text-center text-sm text-mk-muted-foreground">{HERO.primaryCta}</a>
          </nav>
        </div>
      )}
    </header>
  );
}
