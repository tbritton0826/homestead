import useDialogFocus from "../hooks/useDialogFocus.js";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
export default function ProfileToolPortal({ children, onClose }) {
  const host = useRef(null);
  useDialogFocus({ selector: ".profile-tool-portal", onClose });
  useEffect(() => {
    const source = document.querySelector(".profile-page");
    if (source) {
      const style = getComputedStyle(source);
      for (const name of style) if (name.startsWith("--profile-")) host.current?.style.setProperty(name, style.getPropertyValue(name));
    }
  }, []);
  return createPortal(<div className="profile-tool-portal" role="dialog" aria-modal="true" aria-label="Profile tools" ref={host}>{children}</div>, document.body);
}
