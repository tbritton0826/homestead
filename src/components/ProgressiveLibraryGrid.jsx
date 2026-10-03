import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export const LIBRARY_GRID_BATCH = 120;
export default function ProgressiveLibraryGrid({ items, renderItem, className, libraryId, getLetter }) {
  const sourceKey = useMemo(() => JSON.stringify(items.map((item) => item.localId ?? item.id ?? item.artist ?? item.title ?? item.name)), [items]);
  const [windowState, setWindowState] = useState({ sourceKey, limit: LIBRARY_GRID_BATCH });
  // A filter/sort/source change uses its own first batch immediately, without one stale render.
  const limit = windowState.sourceKey === sourceKey ? windowState.limit : LIBRARY_GRID_BATCH;
  const grid = useRef(null), sentinel = useRef(null), jumpLetter = useRef(null), jumpTarget = useRef(null);
  const more = limit < items.length;
  useEffect(() => {
    setWindowState((current) => current.sourceKey === sourceKey ? current : { sourceKey, limit: LIBRARY_GRID_BATCH });
  }, [sourceKey]);
  useEffect(() => {
    const reveal = (event) => {
      if (event.detail?.libraryId !== libraryId) return;
      const index = items.findIndex((item) => getLetter(item) === event.detail.letter);
      if (index < 0) return;
      if (index < limit) { jumpLetter.current = null; jumpTarget.current = null; return; }
      jumpLetter.current = event.detail.letter;
      jumpTarget.current = { sourceKey, limit: Math.min(items.length, index + LIBRARY_GRID_BATCH) };
      setWindowState({ sourceKey, limit: Math.max(limit, Math.min(jumpTarget.current.limit, limit + LIBRARY_GRID_BATCH)) });
    };
    window.addEventListener("homestead-alpha-reveal", reveal);
    return () => window.removeEventListener("homestead-alpha-reveal", reveal);
  }, [items, sourceKey, libraryId, getLetter, limit]);
  useLayoutEffect(() => {
    if (!jumpLetter.current) return;
    if (jumpTarget.current?.sourceKey !== sourceKey) { jumpLetter.current = null; jumpTarget.current = null; return; }
    // Distant alphabet jumps reveal bounded batches between frames instead of one large mount.
    if (limit < jumpTarget.current.limit) {
      const pendingJump = jumpTarget.current;
      const frame = requestAnimationFrame(() => {
        if (jumpTarget.current === pendingJump) setWindowState({ sourceKey, limit: Math.min(pendingJump.limit, limit + LIBRARY_GRID_BATCH) });
      });
      return () => cancelAnimationFrame(frame);
    }
    const target = Array.from(grid.current?.querySelectorAll('[data-alpha-letter]') || []).find((node) => node.dataset.alphaLetter === jumpLetter.current);
    jumpLetter.current = null;
    jumpTarget.current = null;
    if (!target) return;
    const scroller = target.closest('.main');
    if (scroller) scroller.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 96), behavior: 'smooth' });
    else target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [items, sourceKey, limit]);
  const loadMore = () => setWindowState({ sourceKey, limit: Math.min(items.length, limit + LIBRARY_GRID_BATCH) });
  useEffect(() => {
    if (!more || !sentinel.current || typeof IntersectionObserver === 'undefined') return;
    // Mobile main grows with the document; observing that element would expose every sentinel.
    const main = grid.current?.closest('.main');
    const scrollRoot = main && main.scrollHeight > main.clientHeight ? main : null;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !jumpLetter.current) loadMore(); }, { root: scrollRoot, rootMargin: '600px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [items, sourceKey, limit, more]);
  // Reuse unchanged card elements while expanding the window; a metadata or parent change invalidates them.
  const renderedItems = useMemo(() => items.map(renderItem), [items, renderItem]);
  return <>
    <div ref={grid} className={className}>{renderedItems.slice(0, limit)}</div>
    {more && <div ref={sentinel} className="small-muted"><button type="button" className="secondary-button" onClick={loadMore}>Show more · {Math.min(limit, items.length)} of {items.length}</button></div>}
  </>;
}
