// Focus behavior for existing dialogs; no new rendering or modal state layer.
const dialogs = [];
const inerted = new Map();
const focusSelector = 'button, a[href], input, select, textarea, video[controls], audio[controls], iframe, [tabindex]';
export function dialogFocusable(element) {
  return [...element.querySelectorAll(focusSelector)].filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[hidden], [inert]') && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
}
function topDialog() { return dialogs.at(-1); }
function focusInside(record) {
  const target = dialogFocusable(record.element).find(node => !node.className?.includes?.('backdrop')) || record.element;
  target.focus({ preventScroll: true });
}
function updateBackground() {
  for (const [node, value] of inerted) node.inert = value;
  inerted.clear();
  let branch = topDialog()?.element;
  while (branch && branch !== document.body) {
    for (const sibling of branch.parentElement?.children || []) {
      if (sibling === branch || ['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) continue;
      inerted.set(sibling, sibling.inert); sibling.inert = true;
    }
    branch = branch.parentElement;
  }
}
function handleKey(event) {
  const record = topDialog(); if (!record) return;
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation(); record.close(); return;
  }
  if (event.key !== 'Tab') return;
  const nodes = dialogFocusable(record.element), first = nodes[0], last = nodes.at(-1);
  const active = document.activeElement;
  if (!nodes.length) { event.preventDefault(); record.element.focus(); }
  else if (!record.element.contains(active) || (event.shiftKey && (active === first || active === record.element))) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}
function handleFocus(event) {
  const record = topDialog();
  if (record && !record.element.contains(event.target)) focusInside(record);
}
export function activateDialogFocus(element, close, previous = document.activeElement) {
  if (!element) return () => {};
  const tabIndex = element.getAttribute('tabindex');
  element.tabIndex = -1;
  const record = { element, close, previous };
  dialogs.push(record);
  // A child portal/layout effect can register before its parent. DOM order
  // still places the later/nested dialog above its parent.
  dialogs.sort((a, b) => a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  if (dialogs.length === 1) {
    window.addEventListener('keydown', handleKey, true);
    document.addEventListener('focusin', handleFocus, true);
  }
  updateBackground();
  if (topDialog() === record && !element.contains(document.activeElement)) focusInside(record);
  return () => {
    const wasTop = topDialog() === record;
    dialogs.splice(dialogs.indexOf(record), 1);
    if (tabIndex === null) element.removeAttribute('tabindex'); else element.setAttribute('tabindex', tabIndex);
    updateBackground();
    if (!dialogs.length) {
      window.removeEventListener('keydown', handleKey, true);
      document.removeEventListener('focusin', handleFocus, true);
    }
    if (!wasTop) return;
    if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
    else if (topDialog()) focusInside(topDialog());
  };
}
