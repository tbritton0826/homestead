// Visual preview and persistence are independent: no React application update while a pointer is held.
export function createAppearancePreviewBuffer({ preview, commit, delay = 180, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = {}, timer = null, held = false, revision = 0;
  const clear = () => { clearTimer(timer); timer = null; revision++; };
  const flush = () => {
    clear();
    if (!Object.keys(pending).length) return;
    const changes = pending; pending = {};
    commit(changes); preview({});
  };
  return {
    change(key, value) { pending = { ...pending, [key]: value }; preview(pending); clear(); if (!held) { const scheduled = revision; timer = setTimer(() => { if (scheduled === revision && !held) flush(); }, delay); } },
    hold() { held = true; clear(); },
    release() { held = false; flush(); },
    flush,
    cancel() { clear(); held = false; pending = {}; preview({}); },
  };
}

export function appearanceNumericVariables(values) {
  const fields = {
    posterWidth: ['--media-grid-poster-width', 'px'], posterHeight: ['--media-grid-poster-height', 'px'], posterOpacity: ['--media-poster-opacity', ''],
    posterRadius: ['--photo-poster-radius', 'px'], gridGap: ['--media-grid-gap', 'px'],
    panelOpacity: ['--media-panel-opacity', ''], panelBlur: ['--media-panel-blur', 'px'],
    cardOpacity: ['--media-card-opacity', ''], cardBlur: ['--media-card-blur', 'px'],
    overlayOpacity: ['--media-overlay-opacity', ''], overlayBlur: ['--media-overlay-blur', 'px'],
    tabOpacity: ['--media-tab-opacity', ''], tabBlur: ['--media-tab-blur', 'px'],
    headerRibbonOpacity: ['--media-header-ribbon-opacity', ''], filterRibbonOpacity: ['--media-filter-ribbon-opacity', ''],
    alphaInset: ['--media-alpha-inset', 'px'], alphaRailOpacity: ['--media-alpha-rail-opacity', ''],
    backgroundOpacity: ['--library-background-opacity', ''], backgroundBlur: ['--library-background-blur', 'px'],
    headerBackgroundOpacity: ['--library-header-background-opacity', ''], ribbonBackgroundOpacity: ['--library-ribbon-background-opacity', ''],
    sidebarBackgroundOpacity: ['--sidebar-background-opacity', ''], sidebarBackgroundBlur: ['--sidebar-background-blur', 'px'],
  };
  const result = Object.fromEntries(Object.entries(fields).filter(([key]) => values[key] != null).map(([key, [name, unit]]) => [name, String(values[key]) + unit]));
  if (values.posterWidth != null && values.posterHeight != null) result["--media-poster-ratio"] = `${values.posterWidth} / ${values.posterHeight}`;
  for (const prefix of ['movie', 'tv']) {
    result['--'+prefix+'-detail-poster-width'] = (values.detailPosterWidth ?? 300) + 'px';
    result['--'+prefix+'-detail-poster-opacity'] = values.detailPosterOpacity ?? 1;
    result['--'+prefix+'-detail-poster-'+(prefix === 'tv' ? 'offset-' : '')+'x'] = (values.detailPosterOffsetX ?? 0) + 'px';
    result['--'+prefix+'-detail-poster-'+(prefix === 'tv' ? 'offset-' : '')+'y'] = (values.detailPosterOffsetY ?? 18) + 'px';
    result['--'+prefix+'-detail-banner-brightness'] = (values.detailBannerBrightness ?? 100) + '%';
    result['--'+prefix+'-detail-panel-opacity'] = values.detailPanelOpacity ?? .84;
    result['--'+prefix+'-detail-panel-blur'] = (values.detailPanelBlur ?? 10) + 'px';
  }
  return result;
}
