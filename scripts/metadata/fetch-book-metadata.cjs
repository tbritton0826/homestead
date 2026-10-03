// Homestead Books metadata fetcher.
// Providers: OpenLibrary first, Google Books optional fallback/secondary.
// Dependency-free CJS so server.cjs can require it directly.

function strictEncodeQuery(value = "") {
  return encodeURIComponent(String(value || "").trim()).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
}

function getYearFromDate(value) {
  if (!value) return null;
  const year = String(value).slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

function normalizeOpenLibraryBook(book = {}) {
  const title = book.title || "Untitled";
  const authors = normalizeArray(book.author_name || book.authors).map((author) =>
    typeof author === "string" ? author : author?.name
  ).filter(Boolean);

  const isbnList = normalizeArray(book.isbn);
  const openLibraryId = book.key || book.openLibraryId || book.providerId || null;

  return {
    id: openLibraryId || title,
    providerId: openLibraryId,
    provider: "openlibrary",
    mediaType: "book",
    title,
    sortTitle: title,
    year: book.first_publish_year || book.year || null,
    releaseDate: book.first_publish_year ? String(book.first_publish_year) : "",
    authors,
    description:
      typeof book.description === "string"
        ? book.description
        : book.description?.value || "",
    genres: normalizeArray(book.subject).slice(0, 12),
    poster: book.cover_i
      ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg`
      : book.cover || "",
    backdrop: "",
    identifiers: {
      openLibraryId,
      isbn10: isbnList.find((isbn) => String(isbn).length === 10) || null,
      isbn13: isbnList.find((isbn) => String(isbn).length === 13) || null,
    },
    raw: book,
  };
}

function normalizeGoogleBook(item = {}) {
  const volume = item.volumeInfo || item;
  const title = volume.title || "Untitled";
  const identifiers = normalizeArray(volume.industryIdentifiers);
  const imageLinks = volume.imageLinks || {};

  return {
    id: item.id || item.googleBooksId || title,
    providerId: item.id || item.googleBooksId || null,
    provider: "googlebooks",
    mediaType: "book",
    title,
    sortTitle: title,
    year: getYearFromDate(volume.publishedDate),
    releaseDate: volume.publishedDate || "",
    authors: normalizeArray(volume.authors),
    description: volume.description || "",
    genres: normalizeArray(volume.categories),
    poster:
      imageLinks.thumbnail ||
      imageLinks.smallThumbnail ||
      "",
    backdrop: "",
    identifiers: {
      googleBooksId: item.id || item.googleBooksId || null,
      isbn10:
        identifiers.find((identifier) => identifier.type === "ISBN_10")?.identifier ||
        null,
      isbn13:
        identifiers.find((identifier) => identifier.type === "ISBN_13")?.identifier ||
        null,
    },
    raw: item,
  };
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: "application/json",
      "User-Agent": "Homestead/1.0 (metadata-fetch)",
      ...headers,
    },
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Provider returned ${response.status}`);
  }

  return data;
}

async function searchOpenLibrary(query, options = {}) {
  const limit = Number(options.limit || 12);
  const encodedQuery = strictEncodeQuery(query);
  const url = `https://openlibrary.org/search.json?q=${encodedQuery}&limit=${limit}&fields=key,title,author_name,first_publish_year,cover_i,isbn,subject,edition_key`;
  const data = await fetchJson(url);
  const docs = Array.isArray(data?.docs) ? data.docs : [];

  return docs.map(normalizeOpenLibraryBook);
}

async function searchGoogleBooks(query, options = {}) {
  const limit = Number(options.limit || 12);
  const encodedQuery = strictEncodeQuery(query);
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || options.apiKey || "";
  const keyPart = apiKey ? `&key=${strictEncodeQuery(apiKey)}` : "";
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodedQuery}&maxResults=${limit}${keyPart}`;
  const data = await fetchJson(url);
  const items = Array.isArray(data?.items) ? data.items : [];

  return items.map(normalizeGoogleBook);
}

function dedupeBookResults(results = []) {
  const seen = new Set();
  const deduped = [];

  for (const result of results) {
    const key = [
      result.provider,
      result.providerId,
      result.title,
      (result.authors || []).join(","),
      result.year,
    ]
      .filter(Boolean)
      .join(":")
      .toLowerCase();

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

async function searchBookMetadata(query, options = {}) {
  const provider = String(options.provider || "openlibrary").toLowerCase();
  const limit = Number(options.limit || 12);

  if (!query || !String(query).trim()) {
    throw new Error("Missing book metadata search query");
  }

  if (provider === "googlebooks") {
    return searchGoogleBooks(query, { ...options, limit });
  }

  if (provider === "all") {
    const settled = await Promise.allSettled([
      searchOpenLibrary(query, { ...options, limit }),
      searchGoogleBooks(query, { ...options, limit }),
    ]);

    return dedupeBookResults(
      settled.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      )
    ).slice(0, limit);
  }

  return searchOpenLibrary(query, { ...options, limit });
}

module.exports = {
  searchBookMetadata,
  searchOpenLibrary,
  searchGoogleBooks,
  normalizeOpenLibraryBook,
  normalizeGoogleBook,
};
