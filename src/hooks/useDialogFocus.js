import { useLayoutEffect, useRef } from "react";
import { activateDialogFocus } from "../utils/dialog-focus.js";
export default function useDialogFocus({ selector, open = true, onClose, canClose = true }) {
  const callbacks = useRef({ onClose, canClose }); callbacks.current = { onClose, canClose };
  const wasOpen = useRef(false), origin = useRef(null);
  if (open && !wasOpen.current && typeof document !== "undefined") {
    const active = document.activeElement, menu = active?.closest('[role="menu"]');
    origin.current = menu?.id ? [...document.querySelectorAll('[aria-controls]')].find(node => node.getAttribute('aria-controls') === menu.id) || active : active;
  }
  wasOpen.current = open;
  useLayoutEffect(() => {
    if (!open) return;
    return activateDialogFocus(document.querySelector(`[role="dialog"]${selector}`), () => {
      if (callbacks.current.canClose) callbacks.current.onClose?.();
    }, origin.current);
  }, [open, selector]);
}
