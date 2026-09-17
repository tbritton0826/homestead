import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
export default function ProfileToolPortal({ children, onClose }) {
  const host = useRef(null), close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const source = document.querySelector(".profile-page");
    if (source) {
      const style = getComputedStyle(source);
      for (const name of style) if (name.startsWith("--profile-")) host.current?.style.setProperty(name, style.getPropertyValue(name));
    }
    const nodes = () => [...(host.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') || [])].filter((node) => node.getClientRects().length);
    nodes().find((node) => !node.classList.contains("profile-tool-overlay-backdrop"))?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") { event.stopPropagation(); close.current?.(); }
      if (event.key !== "Tab") return;
      const items = nodes(), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const element = host.current; element?.addEventListener("keydown", onKey);
    return () => { element?.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, []);
  return createPortal(<div className="profile-tool-portal" ref={host}>{children}</div>, document.body);
}
