import { useLayoutEffect, useRef } from "react";

// Desktop/kiosk libraries scroll inside .main; mobile may scroll the document.
// Only touch the page's scroll chain, never the sidebar, poster rows or players.
export function resetLibraryScroll(main, doc = globalThis.document, win = globalThis.window) {
  const targets = new Set();
  for (let element = main; element; element = element.parentElement) targets.add(element);
  for (const element of [doc?.scrollingElement, doc?.documentElement, doc?.body]) {
    if (element) targets.add(element);
  }
  for (const element of targets) {
    // Instant also cancels any in-flight smooth alphabet jump on the old page.
    try { element.scrollTo?.({ top: 0, left: 0, behavior: "instant" }); } catch { /* Older webviews use the assignments below. */ }
    element.scrollTop = 0;
    element.scrollLeft = 0;
  }
  try { win?.scrollTo?.({ top: 0, left: 0, behavior: "instant" }); } catch { /* Document targets above cover older webviews. */ }
}

export default function useLibraryScrollReset(activeLibrary) {
  const mainRef = useRef(null);
  // Run after the new library is committed but before it is painted. Data polls,
  // filters, appearance changes and playback updates must not move this page.
  useLayoutEffect(() => {
    resetLibraryScroll(mainRef.current);
  }, [activeLibrary]);
  return mainRef;
}
