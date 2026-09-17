const OPEN_LIBRARY_BASE_URL = "https://openlibrary.org";
const GOOGLE_BOOKS_BASE_URL = "https://www.googleapis.com/books/v1";
const REQUEST_TIMEOUT_MS = 12000;
const REQUEST_RETRY_DELAYS_MS = [0, 450, 1200];
const detailCache = new Map();

function cleanText(value = "") {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function descriptionText(value) {
  return cleanText(typeof value === "string" ? value : value?.value || "");
}

function normalizeTitle(value = "") {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(?:a|an|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeWorkTitle(value = "") {
  return normalizeTitle(String(value || "")
    .replace(/\s*[\[(][^\])]{3,100}[\])]\s*$/i, "")
    .replace(/\s*[(:\[]\s*(?:book|volume|the\s+[^\])]+series\b)[^\])]*[\])]?\s*$/i, "")
    .replace(/\s*:\s*(?:a\s+novel|book\s+\d+).*$/i, ""));
}

function normalizeAuthor(value = "") {
  const tokens = normalizeTitle(value).split(/\s+/).filter((token) => token.length > 1).sort();
  return tokens.join(" ");
}

function unique(values = []) {
  const list = Array.isArray(values) ? values.flat(Infinity) : [values];
  return [...new Set(list.filter(Boolean).map((value) => cleanText(value)).filter(Boolean))];
}

function firstIsbn(values = [], length = 13) {
  return values.map((value) => String(value || "").replace(/[^0-9X]/gi, ""))
    .find((value) => value.length === length) || null;
}

function openLibraryKey(value = "") {
  const match = String(value || "").match(/OL\d+[WM]/i);
  return match ? match[0].toUpperCase() : "";
}

function coverUrl(coverId, size = "L") {
  return coverId ? `https://covers.openlibrary.org/b/id/${encodeURIComponent(coverId)}-${size}.jpg` : "";
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < REQUEST_RETRY_DELAYS_MS.length; attempt += 1) {
    if (REQUEST_RETRY_DELAYS_MS[attempt]) await wait(REQUEST_RETRY_DELAYS_MS[attempt]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || REQUEST_TIMEOUT_MS));
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "Homestead/0.6.8.15" },
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return data;
      const error = new Error(data?.error?.message || data?.error || `${new URL(url).hostname} returned ${response.status}`);
      error.status = response.status;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === REQUEST_RETRY_DELAYS_MS.length - 1) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      const retryable = error?.name === "AbortError" || [429, 500, 502, 503, 504].includes(Number(error?.status));
      if (!retryable || attempt === REQUEST_RETRY_DELAYS_MS.length - 1) {
        if (error?.name === "AbortError") throw new Error(`${new URL(url).hostname} timed out`);
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`${new URL(url).hostname} could not be reached`);
}

function ordinalNumber(value = "") {
  const source = cleanText(value).toLowerCase();
  const numeric = source.match(/\b(\d{1,3})(?:st|nd|rd|th)?\b/);
  if (numeric) return numeric[1];
  const words = { first: "1", second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10", eleventh: "11", twelfth: "12", thirteenth: "13", fourteenth: "14", fifteenth: "15", sixteenth: "16", seventeenth: "17", eighteenth: "18", nineteenth: "19", twentieth: "20" };
  return Object.entries(words).find(([word]) => new RegExp(`\\b${word}\\b`).test(source))?.[1] || "";
}

function cleanSeriesName(value = "") {
  return cleanText(value)
    .replace(/^(?:the\s+)?/i, "")
    .replace(/\s+(?:book|novel|volume)\s*(?:#|no\.?|number)?\s*\d+(?:\.\d+)?\s*$/i, "")
    .replace(/\s+series\s*$/i, "")
    .trim();
}

function plausibleSeriesName(value = "") {
  const series = cleanText(value);
  if (!series || series.length < 2 || series.length > 120) return "";
  if (/\b(?:international(?:ly)?|new\s+york\s+times|usa\s+today|award[- ]winning|bestsell(?:er|ing)|million\s+copies|special\s+edition|collector'?s\s+edition)\b/i.test(series)) return "";
  if (/^(?:book|volume|installment|edition|ordered|unordered|issue)\b/i.test(series)) return "";
  if (/^#?\d+(?:\.\d+)?$/.test(series)) return "";
  return series;
}

function inferSeriesFromText(...values) {
  const source = values.map(descriptionText).filter(Boolean).join(" ");
  if (!source) return { series: "", seriesIndex: "" };
  const patterns = [
    /(?:the\s+)?(\d{1,3}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+(?:book|novel|volume|installment)\s+(?:in|of)\s+(?:the\s+)?([^.;:]{3,80}?)\s+series\b/i,
    /(?:book|novel|volume|installment)\s*(?:#|no\.?|number)?\s*(\d{1,3}(?:\.\d+)?)\s+(?:in|of)\s+(?:the\s+)?([^.;:]{3,80}?)\s+series\b/i,
    /([^.;:]{3,80}?)\s+series\s*[,—-]+\s*(?:book|volume)\s*(?:#|no\.?|number)?\s*(\d{1,3}(?:\.\d+)?)/i,
    /([^.;:]{3,80}?)\s*[,—-]+\s*(?:book|volume)\s*(?:#|no\.?|number)?\s*(\d{1,3}(?:\.\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const numberFirst = /^(?:\d|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)/i.test(match[1]);
    const series = cleanSeriesName(numberFirst ? match[2] : match[1]);
    const seriesIndex = ordinalNumber(numberFirst ? match[1] : match[2]);
    if (series && seriesIndex) return { series, seriesIndex };
  }
  return { series: "", seriesIndex: "" };
}

function descriptionScore(value = "", language = "") {
  const description = descriptionText(value);
  if (!description) return -1;
  let score = Math.min(description.length, 1800);
  if (/^(?:the\s+)?\d+(?:st|nd|rd|th)\s+(?:book|installment|volume)\b/i.test(description) && description.length < 180) score -= 240;
  if (/^(?:no|not)\s+(?:description|synopsis)\b/i.test(description)) score -= 1000;
  if (!language || /^(?:en|eng|english)$/i.test(language)) score += 140;
  if (description.length >= 280) score += 160;
  return score;
}

function bestDescription(candidates = []) {
  return candidates
    .flatMap((candidate) => [
      { value: candidate.description, language: candidate.languages?.[0] || candidate.edition?.language || "" },
      { value: candidate.raw?.volumeInfo?.description, language: candidate.raw?.volumeInfo?.language || "" },
      { value: candidate.raw?.work?.description || candidate.raw?.work?.first_sentence, language: "eng" },
      { value: candidate.raw?.edition?.description, language: candidate.languages?.[0] || "" },
    ])
    .map((entry) => ({ ...entry, value: descriptionText(entry.value), score: descriptionScore(entry.value, entry.language) }))
    .filter((entry) => entry.value && entry.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.value || "";
}

function compatibleWork(candidate = {}, selected = {}) {
  const aTitle = normalizeWorkTitle(candidate.title);
  const bTitle = normalizeWorkTitle(selected.title);
  if (!aTitle || !bTitle || aTitle !== bTitle) return false;
  const aAuthor = normalizeAuthor(candidate.authors?.[0] || "");
  const bAuthor = normalizeAuthor(selected.authors?.[0] || "");
  return !aAuthor || !bAuthor || aAuthor === bAuthor;
}

function chooseSeries(candidates = []) {
  for (const candidate of candidates) {
    const series = plausibleSeriesName(cleanText(candidate.series || "")
      .replace(/\s+(?:book|novel|volume)\s*(?:#|no\.?|number)?\s*\d+(?:\.\d+)?\s*$/i, "")
      .trim());
    const seriesIndex = cleanText(candidate.seriesIndex || "");
    if (series) return { series, seriesIndex };
  }
  for (const candidate of candidates) {
    const inferred = inferSeriesFromText(candidate.subtitle, candidate.description, candidate.raw?.volumeInfo?.description, candidate.raw?.work?.description);
    if (inferred.series) return inferred;
  }
  return { series: "", seriesIndex: "" };
}

function mergeWorkMetadata(selected = {}, compatible = []) {
  const candidates = [selected, ...compatible.filter((entry) => entry !== selected)];
  const { series, seriesIndex } = chooseSeries(candidates);
  return {
    ...selected,
    description: bestDescription(candidates) || selected.description || "",
    series: series || plausibleSeriesName(selected.series) || "",
    seriesIndex: seriesIndex || selected.seriesIndex || "",
    genres: unique(candidates.flatMap((entry) => entry.genres || [])).slice(0, 24),
    metadataSources: unique(candidates.map((entry) => entry.provider)),
    metadataMergedFromEditions: candidates.length,
  };
}

async function cachedJson(url) {
  const cached = detailCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const data = await fetchJson(url);
  detailCache.set(url, { data, expiresAt: Date.now() + 60 * 60 * 1000 });
  if (detailCache.size > 500) detailCache.delete(detailCache.keys().next().value);
  return data;
}

function seriesFromGoogle(info = {}) {
  const seriesInfo = info.seriesInfo || {};
  const volumes = Array.isArray(seriesInfo.volumeSeries) ? seriesInfo.volumeSeries : [];
  const series = cleanText(
    seriesInfo.seriesTitle ||
    info.series ||
    ""
  );
  const seriesIndex = cleanText(
    seriesInfo.bookDisplayNumber ||
    volumes[0]?.orderNumber?.number ||
    volumes[0]?.issue?.[0]?.issueDisplayNumber ||
    ""
  );
  return { series, seriesIndex };
}

function normalizeGoogleVolume(entry = {}) {
  const info = entry.volumeInfo || {};
  const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
  const isbn10 = identifiers.find((item) => item.type === "ISBN_10")?.identifier || null;
  const isbn13 = identifiers.find((item) => item.type === "ISBN_13")?.identifier || null;
  const images = info.imageLinks || {};
  const poster = images.extraLarge || images.large || images.medium || images.small || images.thumbnail || images.smallThumbnail || "";
  const { series, seriesIndex } = seriesFromGoogle(info);
  return {
    id: `googlebooks:${entry.id}`,
    providerId: entry.id,
    provider: "googlebooks",
    mediaType: "book",
    recordType: "edition",
    title: cleanText(info.title || "Untitled"),
    subtitle: cleanText(info.subtitle || ""),
    year: String(info.publishedDate || "").slice(0, 4) || null,
    releaseDate: cleanText(info.publishedDate || ""),
    publishedDate: cleanText(info.publishedDate || ""),
    authors: unique(info.authors || []),
    description: descriptionText(info.description),
    genres: unique(info.categories || []).slice(0, 24),
    poster,
    backdrop: "",
    publisher: cleanText(info.publisher || ""),
    pageCount: Number(info.pageCount || 0) || null,
    languages: unique([info.language]),
    series,
    seriesIndex,
    identifiers: {
      googleBooksId: entry.id,
      isbn10,
      isbn13,
    },
    edition: {
      publisher: cleanText(info.publisher || ""),
      publishedDate: cleanText(info.publishedDate || ""),
      language: cleanText(info.language || ""),
      pageCount: Number(info.pageCount || 0) || null,
      isbn10,
      isbn13,
    },
    artwork: poster ? [{ url: poster, source: "Google Books", kind: "edition", label: [info.publisher, info.publishedDate].filter(Boolean).join(" · ") || "Google Books cover", isbn: isbn13 || isbn10 || "" }] : [],
    providerUrl: info.infoLink || "",
    raw: entry,
  };
}

function normalizeOpenLibraryEdition(edition = {}, work = {}) {
  const editionKey = openLibraryKey(edition.key || edition.cover_edition_key || "");
  const workKey = openLibraryKey(work.key || edition.work_key?.[0] || edition.works?.[0]?.key || "");
  const isbns = unique([...(edition.isbn || []), ...(edition.isbn_10 || []), ...(edition.isbn_13 || [])]);
  const coverId = edition.cover_i || edition.covers?.find((value) => Number(value) > 0) || work.cover_i || null;
  const publishDate = cleanText(edition.publish_date || edition.publish_year?.[0] || work.first_publish_year || "");
  const publishers = unique(edition.publisher || edition.publishers || []);
  const languageValues = edition.language || edition.languages || [];
  const languages = unique((Array.isArray(languageValues) ? languageValues : [languageValues]).map((value) => typeof value === "string" ? value.replace(/^\/languages\//, "") : value?.key?.replace(/^\/languages\//, "")));
  const seriesValues = unique(edition.series || work.series || []);
  const title = cleanText(edition.title || work.title || "Untitled");
  return {
    id: editionKey ? `openlibrary:${editionKey}` : `openlibrary:${workKey || title}`,
    providerId: editionKey ? `/books/${editionKey}` : workKey ? `/works/${workKey}` : "",
    provider: "openlibrary",
    mediaType: "book",
    recordType: editionKey ? "edition" : "work",
    workId: workKey,
    editionId: editionKey,
    title,
    subtitle: cleanText(edition.subtitle || ""),
    year: (publishDate.match(/(?:19|20)\d{2}/) || [])[0] || Number(work.first_publish_year || 0) || null,
    releaseDate: publishDate,
    publishedDate: publishDate,
    authors: unique(work.author_name || edition.author_name || []),
    description: descriptionText(edition.description || work.description || work.first_sentence),
    genres: unique(work.subject || edition.subjects || []).slice(0, 24),
    poster: coverUrl(coverId),
    backdrop: "",
    publisher: publishers[0] || "",
    pageCount: Number(edition.number_of_pages || work.number_of_pages_median || 0) || null,
    languages,
    series: seriesValues[0] || "",
    seriesIndex: "",
    identifiers: {
      openLibraryId: editionKey ? `/books/${editionKey}` : workKey ? `/works/${workKey}` : null,
      openLibraryWorkId: workKey || null,
      openLibraryEditionId: editionKey || null,
      isbn10: firstIsbn(isbns, 10),
      isbn13: firstIsbn(isbns, 13),
    },
    edition: {
      publisher: publishers[0] || "",
      publishers,
      publishedDate: publishDate,
      languages,
      pageCount: Number(edition.number_of_pages || work.number_of_pages_median || 0) || null,
      isbn10: firstIsbn(isbns, 10),
      isbn13: firstIsbn(isbns, 13),
    },
    artwork: coverId ? [{ url: coverUrl(coverId), source: "Open Library", kind: editionKey ? "edition" : "work", label: [publishers[0], publishDate].filter(Boolean).join(" · ") || "Open Library cover", isbn: firstIsbn(isbns, 13) || firstIsbn(isbns, 10) || "", coverId }] : [],
    providerUrl: editionKey ? `${OPEN_LIBRARY_BASE_URL}/books/${editionKey}` : workKey ? `${OPEN_LIBRARY_BASE_URL}/works/${workKey}` : "",
    raw: { edition, work },
  };
}

function editionDocsForWork(work = {}) {
  const nested = work.editions?.docs;
  if (Array.isArray(nested) && nested.length) return nested;
  const keys = Array.isArray(work.edition_key) ? work.edition_key : [];
  const covers = Array.isArray(work.cover_edition_key) ? work.cover_edition_key : [work.cover_edition_key].filter(Boolean);
  return keys.slice(0, 8).map((key, index) => ({
    key: `/books/${key}`,
    title: work.title,
    publish_date: work.publish_date?.[index] || work.first_publish_year,
    isbn: work.isbn || [],
    cover_edition_key: covers[0],
    cover_i: work.cover_i,
  }));
}

async function searchOpenLibrary(query, limit) {
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.max(3, Math.min(12, Math.ceil(limit / 2)))),
    fields: "key,title,author_name,first_publish_year,cover_i,cover_edition_key,edition_key,isbn,subject,first_sentence,number_of_pages_median,editions",
  });
  const data = await fetchJson(`${OPEN_LIBRARY_BASE_URL}/search.json?${params.toString()}`);
  const works = Array.isArray(data.docs) ? data.docs : [];
  const candidates = [];
  for (const work of works) {
    const editions = editionDocsForWork(work);
    if (editions.length) editions.slice(0, 6).forEach((edition) => candidates.push(normalizeOpenLibraryEdition(edition, work)));
    else candidates.push(normalizeOpenLibraryEdition({}, work));
  }
  return candidates.slice(0, limit);
}

async function searchGoogleBooks(query, limit) {
  const params = new URLSearchParams({ q: query, maxResults: String(Math.max(5, Math.min(40, limit))), projection: "full" });
  const data = await fetchJson(`${GOOGLE_BOOKS_BASE_URL}/volumes?${params.toString()}`);
  return (Array.isArray(data.items) ? data.items : []).map(normalizeGoogleVolume).slice(0, limit);
}

function candidateScore(candidate, query) {
  const normalizedQuery = normalizeTitle(query);
  const title = normalizeTitle(candidate.title);
  let score = title === normalizedQuery ? 100 : normalizedQuery.includes(title) || title.includes(normalizedQuery) ? 75 : 40;
  const queryCode = String(query || "").replace(/[^0-9X]/gi, "");
  if ([candidate.identifiers?.isbn13, candidate.identifiers?.isbn10].filter(Boolean).includes(queryCode)) score += 250;
  if (candidate.recordType === "edition") score += 8;
  if (candidate.identifiers?.isbn13 || candidate.identifiers?.isbn10) score += 8;
  if (candidate.poster) score += 5;
  if (candidate.description) score += 4;
  return score;
}

async function hydrateOpenLibraryDescriptions(candidates = []) {
  const workIds = unique(candidates.map((candidate) => candidate.workId)).slice(0, 6);
  const descriptions = new Map();
  await Promise.all(workIds.map(async (workId) => {
    try {
      const data = await cachedJson(`${OPEN_LIBRARY_BASE_URL}/works/${workId}.json`);
      descriptions.set(workId, descriptionText(data.description || data.first_sentence));
    } catch {}
  }));
  return candidates.map((candidate) => ({ ...candidate, description: candidate.description || descriptions.get(candidate.workId) || "" }));
}

async function searchBookMetadataDetailed(query, options = {}) {
  const cleanQuery = cleanText(query);
  if (!cleanQuery) return { results: [], providerStatus: {}, warnings: [], partial: false };
  const limit = Math.max(1, Math.min(30, Number(options.limit || 12)));
  const provider = String(options.provider || "auto").toLowerCase();
  const jobs = [];
  if (["auto", "all", "openlibrary"].includes(provider)) jobs.push({ provider: "openlibrary", promise: searchOpenLibrary(cleanQuery, limit).then(hydrateOpenLibraryDescriptions) });
  if (["auto", "all", "googlebooks", "google"].includes(provider)) jobs.push({ provider: "googlebooks", promise: searchGoogleBooks(cleanQuery, limit) });
  const settled = await Promise.allSettled(jobs.map((job) => job.promise));
  const providerStatus = {};
  settled.forEach((entry, index) => {
    const name = jobs[index].provider;
    providerStatus[name] = entry.status === "fulfilled"
      ? { ok: true, resultCount: entry.value.length }
      : { ok: false, resultCount: 0, message: entry.reason?.message || `${name} search failed` };
  });
  const warnings = Object.entries(providerStatus)
    .filter(([, status]) => !status.ok)
    .map(([name, status]) => `${name === "openlibrary" ? "Open Library" : "Google Books"}: ${status.message}`);
  const results = settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
  const seen = new Set();
  const ordered = results
    .filter((candidate) => {
      const key = candidate.identifiers?.isbn13 || candidate.identifiers?.isbn10 || `${candidate.provider}:${candidate.editionId || candidate.providerId}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => candidateScore(b, cleanQuery) - candidateScore(a, cleanQuery) || String(b.year || "").localeCompare(String(a.year || "")));

  if (options.mode === "auto-match") {
    const works = new Map();
    for (const candidate of ordered) {
      const workKey = `${normalizeWorkTitle(candidate.title)}|${normalizeAuthor(candidate.authors?.[0] || "")}`;
      const current = works.get(workKey);
      if (!current) {
        works.set(workKey, candidate);
      } else {
        works.set(workKey, mergeWorkMetadata(
          candidateScore(candidate, cleanQuery) > candidateScore(current, cleanQuery) ? candidate : current,
          [current, candidate]
        ));
      }
    }
    return { results: [...works.values()].slice(0, limit), providerStatus, warnings, partial: warnings.length > 0 && results.length > 0 };
  }

  return { results: ordered.slice(0, limit), providerStatus, warnings, partial: warnings.length > 0 && results.length > 0 };
}

async function searchBookMetadata(query, options = {}) {
  return (await searchBookMetadataDetailed(query, options)).results;
}

async function enrichOpenLibraryCandidate(candidate = {}) {
  const editionId = openLibraryKey(candidate.editionId || candidate.identifiers?.openLibraryEditionId || candidate.providerId);
  const originalWorkId = openLibraryKey(candidate.workId || candidate.identifiers?.openLibraryWorkId || "");
  let edition = candidate.raw?.edition || {};
  if (editionId) {
    try { edition = await cachedJson(`${OPEN_LIBRARY_BASE_URL}/books/${editionId}.json`); } catch {}
  }
  const workId = originalWorkId || openLibraryKey(edition.works?.[0]?.key || "");
  let work = candidate.raw?.work || {};
  if (workId) {
    try { work = await cachedJson(`${OPEN_LIBRARY_BASE_URL}/works/${workId}.json`); } catch {}
  }
  const normalized = normalizeOpenLibraryEdition(edition, {
    ...work,
    key: workId ? `/works/${workId}` : work.key,
    author_name: candidate.authors || [],
    subject: work.subjects || candidate.genres || [],
    first_publish_year: candidate.year,
  });
  return {
    ...candidate,
    ...normalized,
    authors: normalized.authors.length ? normalized.authors : candidate.authors || [],
    description: normalized.description || candidate.description || "",
    series: normalized.series || candidate.series || "",
    seriesIndex: normalized.seriesIndex || candidate.seriesIndex || "",
  };
}

async function enrichGoogleCandidate(candidate = {}) {
  const id = candidate.identifiers?.googleBooksId || candidate.providerId || String(candidate.id || "").replace(/^googlebooks:/, "");
  if (!id) return candidate;
  try { return { ...candidate, ...normalizeGoogleVolume(await cachedJson(`${GOOGLE_BOOKS_BASE_URL}/volumes/${encodeURIComponent(id)}`)) }; }
  catch { return candidate; }
}

async function enrichBookCandidate(candidate = {}) {
  return candidate.provider === "googlebooks" ? enrichGoogleCandidate(candidate) : enrichOpenLibraryCandidate(candidate);
}

function artworkKey(art = {}) {
  const coverId = art.coverId ? `ol:${art.coverId}` : "";
  const url = String(art.url || "").replace(/^http:/, "https:").replace(/[?&](?:zoom|w|width|img|maxwidth|maxheight)=\d+/gi, "");
  return coverId || url;
}

async function openLibraryEditionArtwork(candidate = {}) {
  const workId = openLibraryKey(candidate.workId || candidate.identifiers?.openLibraryWorkId || "");
  if (!workId) return [];
  try {
    const data = await fetchJson(`${OPEN_LIBRARY_BASE_URL}/works/${workId}/editions.json?limit=100`);
    return (Array.isArray(data.entries) ? data.entries : []).flatMap((edition) => {
      const coverId = edition.covers?.find((value) => Number(value) > 0);
      if (!coverId) return [];
      const isbns = unique([...(edition.isbn_10 || []), ...(edition.isbn_13 || [])]);
      return [{
        url: coverUrl(coverId),
        source: "Open Library",
        kind: "edition",
        label: [edition.publishers?.[0], edition.publish_date].filter(Boolean).join(" · ") || "Open Library edition",
        editionId: openLibraryKey(edition.key),
        isbn: firstIsbn(isbns, 13) || firstIsbn(isbns, 10) || "",
        language: edition.languages?.[0]?.key?.replace(/^\/languages\//, "") || "",
        coverId,
      }];
    });
  } catch { return []; }
}

async function googleArtwork(candidate = {}) {
  const isbn = candidate.identifiers?.isbn13 || candidate.identifiers?.isbn10 || "";
  const titleQuery = `intitle:${candidate.title}${candidate.authors?.[0] ? ` inauthor:${candidate.authors[0]}` : ""}`;
  try {
    const searches = [searchGoogleBooks(titleQuery, 30)];
    if (isbn) searches.unshift(searchGoogleBooks(`isbn:${isbn}`, 10));
    const results = (await Promise.all(searches)).flat();
    return results.flatMap((entry) => entry.artwork || []);
  } catch { return []; }
}

async function compatibleMetadata(candidate = {}) {
  const author = candidate.authors?.[0] || "";
  const query = [candidate.title, author].filter(Boolean).join(" ");
  if (!query) return [];
  const settled = await Promise.allSettled([
    searchOpenLibrary(query, 36).then(hydrateOpenLibraryDescriptions),
    searchGoogleBooks(`intitle:${candidate.title}${author ? ` inauthor:${author}` : ""}`, 40),
  ]);
  const all = settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
  return all.filter((entry) => compatibleWork(entry, candidate));
}

async function searchBookArtwork(candidate = {}) {
  const enriched = await enrichBookCandidate(candidate);
  const [openLibrary, google, compatible] = await Promise.all([
    openLibraryEditionArtwork(enriched),
    googleArtwork(enriched),
    compatibleMetadata(enriched),
  ]);
  const metadata = mergeWorkMetadata(enriched, compatible);
  const exactIsbn = enriched.identifiers?.isbn13 || enriched.identifiers?.isbn10 || "";
  const all = [
    ...(enriched.artwork || []),
    ...compatible.flatMap((entry) => (entry.artwork || []).map((art) => ({
      ...art,
      metadataCandidate: entry,
      providerId: entry.providerId || "",
    }))),
    ...openLibrary,
    ...google,
  ];
  const seen = new Set();
  const artwork = all.filter((entry) => {
    const key = artworkKey(entry);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((entry) => ({ ...entry, exactEdition: Boolean(exactIsbn && entry.isbn === exactIsbn) }))
    .sort((a, b) => Number(b.exactEdition) - Number(a.exactEdition) || String(a.source || "").localeCompare(String(b.source || "")))
    .slice(0, 80);
  return {
    metadata,
    artwork,
    workSummary: {
      compatibleEditions: compatible.length + 1,
      descriptionMerged: Boolean(metadata.description && metadata.description !== enriched.description),
      seriesMerged: Boolean(metadata.series && metadata.series !== enriched.series),
    },
  };
}

module.exports = {
  searchBookMetadata,
  searchBookMetadataDetailed,
  enrichBookCandidate,
  searchBookArtwork,
  normalizeGoogleVolume,
  normalizeOpenLibraryEdition,
};
