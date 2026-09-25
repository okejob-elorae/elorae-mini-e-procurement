"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Top progress bar for page changes.
 *
 * It used to start when `usePathname()` changed — which only happens once the
 * new page has ARRIVED — and vanish 500 ms later. So during the wait, the only
 * moment feedback matters, nothing moved at all, and the bar then announced a
 * load that was already over. Clicking a menu item felt like the click had not
 * registered.
 *
 * Now it starts on the click itself: a capture-phase listener catches every
 * same-origin link that leads to a DIFFERENT page, the bar creeps towards 90 %
 * while the server works, and the pathname change completes it. Links that
 * only change the query string (filters, tabs) don't start it — those
 * re-render in place and the pathname never changes to finish the bar.
 */

type Phase = "idle" | "loading" | "done";

/** A safety net: a navigation that never lands must not leave the bar up. */
const GIVE_UP_MS = 12000;
const FADE_MS = 250;

export function GlobalLoadingBar() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("idle");
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function start() {
      if (fade.current) clearTimeout(fade.current);
      if (giveUp.current) clearTimeout(giveUp.current);
      setPhase("loading");
      giveUp.current = setTimeout(() => setPhase("idle"), GIVE_UP_MS);
    }

    function onClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      start();
    }

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", start);
    };
  }, []);

  // The new page has rendered: finish the bar, then let it fade out.
  useEffect(() => {
    if (giveUp.current) clearTimeout(giveUp.current);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the pathname change IS the "navigation finished" event
    setPhase((p) => (p === "loading" ? "done" : p));
    fade.current = setTimeout(() => setPhase("idle"), FADE_MS);
    return () => {
      if (fade.current) clearTimeout(fade.current);
    };
  }, [pathname]);

  if (phase === "idle") return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-9999 h-[3px]"
      role="progressbar"
      aria-label="Memuat halaman"
      aria-busy={phase === "loading"}
    >
      <div
        className={
          phase === "loading"
            ? "global-loading-bar h-full bg-primary"
            : "global-loading-bar-done h-full bg-primary"
        }
      />
    </div>
  );
}
