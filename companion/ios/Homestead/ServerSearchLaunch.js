// Open the server's existing search once React (and, if needed, sign-in) is ready.
// Results, permissions, plugins, and request actions stay owned by the web app.
(() => {
  const style = document.createElement('style');
  style.textContent = '.mobile-bottom-nav { display: none !important; }';
  document.head.appendChild(style);
  function closeNative(event) {
    const bridge = window.webkit?.messageHandlers?.homesteadSearch;
    if (!bridge) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    bridge.postMessage('close');
  }
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('button');
    if (!button?.closest('.spotlight-search-overlay')) return;
    const isBackdrop = button.getAttribute('aria-label') === 'Close global search';
    const isClose = button.closest('.spotlight-search-topbar') && button.textContent.trim() === 'Close';
    if (isBackdrop || isClose) closeNative(event);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.querySelector('.spotlight-search-overlay')) closeNative(event);
  }, true);
  let finished = false;
  let observer;
  let timeout;
  function stop() {
    finished = true;
    if (observer) observer.disconnect();
    if (timeout) clearTimeout(timeout);
  }
  function openSearch() {
    if (finished) return;
    if (document.querySelector('.spotlight-search-overlay[aria-label="Global search"]')) {
      stop();
      return;
    }
    const button = document.querySelector('button.app-ribbon-search-button');
    if (!button || button.disabled || button.getClientRects().length === 0) return;
    stop();
    button.click();
  }
  observer = new MutationObserver(openSearch);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  // If login takes longer, the server's own search button remains available.
  timeout = setTimeout(stop, 60000);
  window.addEventListener('pagehide', stop, { once: true });
  openSearch();
})();
