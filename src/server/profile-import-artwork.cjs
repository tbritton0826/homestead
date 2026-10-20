const fs = require('node:fs');
const path = require('node:path');
const roles = new Set(['poster', 'banner', 'headshot', 'trailer']);
function artworkRole(record = {}) {
  return [record.action, record.type, record.destinationType].find(value => roles.has(value)) || '';
}
function relativeArtwork(record, role) {
  const relative = String(record.relativeDestination || '').replace(/\\/g, '/');
  return new RegExp('^' + role + '\\.(?:jpe?g|png|webp|gif|avif|heic|heif|mp4|m4v|mov|webm|mkv)$', 'i').test(relative) ? relative : '';
}
function applyImportedArtwork(document, record) {
  const role = artworkRole(record);
  if (!role) return document;
  const relative = relativeArtwork(record, role);
  if (!relative) return document;
  const metadata = document.metadata || {};
  const selectedField = 'selected' + role[0].toUpperCase() + role.slice(1);
  const updatedAt = record.savedAt || new Date().toISOString();
  return {
    ...document, [role]: relative, [selectedField]: relative, [role + "Cutout"]: "",
    metadata: {
      ...metadata, [role]: relative, [selectedField]: relative, [role + "Cutout"]: "",
      artworkPreferences: { ...(metadata.artworkPreferences || {}), useCutouts: { ...(metadata.artworkPreferences?.useCutouts || {}), [role]: false } },
      artworkUpdatedAt: updatedAt,
      artworkHistory: [{ action: role, relativeDestination: relative, updatedAt, sourcePath: record.directUrl || record.sourceUrl || 'device-upload' },
        ...(Array.isArray(metadata.artworkHistory) ? metadata.artworkHistory : [])].slice(0, 100),
    },
  };
}
function selectedProfileArtwork(profileDir, document = {}, role = 'poster') {
  if (!roles.has(role) || !profileDir || !fs.existsSync(profileDir)) return null;
  const metadata = document.metadata || document;
  // Old wizard imports recorded the user's choice without updating poster.
  const records = [...(Array.isArray(metadata.artworkHistory) ? metadata.artworkHistory : []),
    ...(Array.isArray(metadata.imports) ? metadata.imports : [])]
    .filter(record => artworkRole(record) === role)
    .sort((a, b) => String(b.updatedAt || b.savedAt || '').localeCompare(String(a.updatedAt || a.savedAt || '')));
  records.push({ relativeDestination: metadata[role] }, { relativeDestination: document[role] });
  const realRoot = fs.realpathSync(profileDir);
  for (const record of records) {
    const relative = relativeArtwork(record, role);
    if (!relative) continue;
    const file = path.join(profileDir, relative);
    try {
      const real = fs.realpathSync(file);
      if (!real.startsWith(realRoot + path.sep)) continue;
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      return { file, relative, revision: String(stat.mtimeMs) + '-' + stat.size };
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  return null;
}
module.exports = { applyImportedArtwork, selectedProfileArtwork };
