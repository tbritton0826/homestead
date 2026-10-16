const ADULT_PROFILES = new Set(['personal', 'girls', 'performers', 'celebrities']);
export function profileMetadataPills(profile, { allowIntimate = false, formatBirthday = value => value, measurements = '', now = new Date() } = {}) {
  const metadata = profile.metadata || {}, body = metadata.bodyDetails || metadata.body || {};
  const sources = [metadata, body, profile];
  const value = (...keys) => {
    for (const key of keys) for (const source of sources) {
      let item = source[key];
      if (Array.isArray(item)) item = item.map(entry => entry?.name || entry?.label || entry).join(', ');
      if (item && typeof item === 'object') item = item.unit ? `${item.value ?? item.amount ?? ''} ${item.unit}` : item.name || item.label;
      if (item != null && String(item).trim() && String(item).trim() !== '—') return String(item).trim();
    }
    return '';
  };
  const birthday = value('birthday', 'birthDate', 'birthdate', 'dateOfBirth');
  const birth = /^\d{4}-\d{2}-\d{2}/.test(birthday) ? new Date(birthday.slice(0, 10) + 'T00:00:00Z') : null;
  let age = birth && Number.isFinite(birth.getTime()) ? now.getUTCFullYear() - birth.getUTCFullYear() : null;
  if (age !== null && (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate()))) age--;
  const child = sources.some(source => source.isChild === true || ['library', 'libraryType', 'profileType', 'role', 'kind'].some(key => ['child', 'children', 'minor'].includes(String(source[key] || '').toLowerCase()))) || (age !== null && age < 18);
  const sensitive = allowIntimate && ADULT_PROFILES.has(profile.library) && !child;
  const result = [], add = (id, label, text, icon, intimate = false) => { if (text && text !== '—' && (!intimate || sensitive)) result.push({ id, label, text, icon, intimate }); };
  add('bio', 'Biography', value('biography', 'bio', 'description', 'summary') ? 'Bio' : '', 'ⓘ');
  add('clothing', 'Clothing size', value('clothingSize', 'dressSize'), '👕');
  add('panty', 'Panty size', value('pantySize', 'underwearSize'), '🩲', true);
  add('bra', 'Bra size', value('braSize'), '👙', true);
  add('measurements', 'Body measurements', measurements && measurements !== '—' ? measurements : value('measurements', 'measurementsRaw', 'bodyMeasurements'), '📏', true);
  add('birthday', 'Birthday', birthday ? formatBirthday(birthday) : '', '🎂');
  add('everyday', 'Everyday cut', [value('everydayCut'), metadata.seamless === true ? 'Seamless' : ''].filter(Boolean).join(' / '), '✨', true);
  add('period', 'Period cut', value('periodCut'), '🩸', true);
  add('country', 'Country', value('country', 'nationality'), '🌐');
  add('occupation', 'Occupation', value('occupation', 'occupations'), '💼');
  return result;
}

export function recipeEditorDraft(recipe = {}, defaults = {}) {
  return { ...defaults, ...recipe, ingredients: (recipe.ingredients || []).join('\n'), directions: (recipe.directions || []).join('\n'), tags: (recipe.tags || []).join(', '), imageUrl: '', imageDataUrl: '' };
}
export function recipeEditingAllowed(user, config) {
  return Boolean(user && user.readOnly !== true && config?.subscription?.features?.recipes === true &&
    (user.role === 'owner' || (user.allowedLibraries || []).some(library => ['*', 'family', 'recipes'].includes(library))));
}
