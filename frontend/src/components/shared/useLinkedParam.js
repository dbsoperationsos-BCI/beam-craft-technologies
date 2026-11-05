"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * A record named in the address - `?shoot=<id>` from the calendar - and a way to let it go once it
 * has been opened, so the address no longer reopens it on a reload and Back does not either: cleared
 * with `replace`, which leaves no history entry of its own.
 */
export default function useLinkedParam(name) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(name) || "";
  const clear = useCallback(() => {
    if (!value) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete(name);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [name, pathname, router, searchParams, value]);
  return [value, clear];
}
