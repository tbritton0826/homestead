export function createFeatureLoader(load) {
  let pending;
  return () => {
    if (!pending) pending = Promise.resolve().then(load).catch((error) => { pending = null; throw error; });
    return pending;
  };
}
export const loadEpub = createFeatureLoader(() => import('epubjs'));
export const loadHls = createFeatureLoader(() => import('hls.js'));
export const loadBarcodeReader = createFeatureLoader(() => import('@zxing/browser'));
