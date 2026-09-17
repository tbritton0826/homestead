import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

function text(value = "") {
  return String(value || "").trim();
}

function bookLocalId(item = {}) {
  return text(item.localId || item.id || item.path || item.filePath || item.folderPath || item.sourcePath || item.title);
}

function isbnFor(candidate = {}) {
  return candidate.identifiers?.isbn13 || candidate.identifiers?.isbn10 || candidate.edition?.isbn13 || candidate.edition?.isbn10 || "";
}

function resultKey(candidate = {}) {
  return candidate.id || candidate.providerId || `${candidate.provider}-${candidate.title}-${isbnFor(candidate)}`;
}

function sourceLabel(value = "") {
  return value === "googlebooks" ? "Google Books" : value === "openlibrary" ? "Open Library" : text(value) || "Metadata provider";
}

export default function BookMetadataMatchModal({ item, onClose, onSaved }) {
  const initialQuery = useMemo(() => [item?.title, item?.author].filter(Boolean).join(" "), [item]);
  const existingMatch = item?.metadataMatch?.matchLocked || item?.metadataMatch?.fixedMatch ? item.metadataMatch : null;
  const [query, setQuery] = useState(initialQuery);
  const [provider, setProvider] = useState("all");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [artwork, setArtwork] = useState([]);
  const [selectedArtwork, setSelectedArtwork] = useState(null);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [description, setDescription] = useState("");
  const [series, setSeries] = useState("");
  const [seriesIndex, setSeriesIndex] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [titleValue, setTitleValue] = useState(item?.title || "");
  const [authorValue, setAuthorValue] = useState(item?.author || "");
  const [editingExisting, setEditingExisting] = useState(Boolean(existingMatch));

  async function search(nextQuery = query, nextProvider = provider) {
    const cleaned = text(nextQuery);
    if (!cleaned) return;
    setStatus("searching");
    setMessage("");
    setSelected(null);
    setMetadata(null);
    setArtwork([]);
    try {
      const params = new URLSearchParams({ query: cleaned, provider: nextProvider, limit: "30" });
      const response = await fetch(`/api/books/metadata/search?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.message || "Book search failed.");
      setResults(data.results || []);
      setStatus("results");
      const warnings = Array.isArray(data.warnings) ? data.warnings : [];
      if (warnings.length) {
        setMessage(`${data.partial ? "Showing results from the available source. " : ""}${warnings.join(" · ")} You can retry without losing this search.`);
      } else if (!(data.results || []).length) {
        setMessage("No editions matched that search. Try the ISBN or a shorter title.");
      }
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "Book search failed.");
    }
  }

  useEffect(() => {
    setQuery(initialQuery);
    if (existingMatch) {
      const currentPoster = existingMatch.artworkOverrides?.gridPoster || existingMatch.gridPoster || existingMatch.poster || item?.poster || "";
      const currentArtwork = currentPoster ? { url: currentPoster, source: "Saved artwork", label: "Current cover", preservedLocal: true } : null;
      const currentAuthors = Array.isArray(existingMatch.authors) ? existingMatch.authors.join(", ") : text(existingMatch.authors || existingMatch.author);
      setEditingExisting(true);
      setSelected(existingMatch);
      setMetadata(existingMatch);
      setTitleValue(existingMatch.title || item?.title || "");
      setAuthorValue(currentAuthors || item?.author || "");
      setDescription(existingMatch.description || "");
      setSeries(existingMatch.series || existingMatch.metadata?.series || "");
      setSeriesIndex(existingMatch.seriesIndex || existingMatch.metadata?.seriesIndex || "");
      setArtwork(currentArtwork ? [currentArtwork] : []);
      setSelectedArtwork(currentArtwork);
      setStatus("review");
      setMessage("Edit the saved book details below. Your fixed edition and provider identity remain locked.");
    } else {
      setEditingExisting(false);
      search(initialQuery, "all");
    }
    // The active item is the identity boundary for this modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  async function reviewCandidate(candidate) {
    setSelected(candidate);
    setStatus("artwork-loading");
    setMessage("Fetching synopsis, edition details, and alternate covers…");
    try {
      const response = await fetch("/api/books/metadata/artwork-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.message || "Artwork lookup failed.");
      const options = data.artwork || [];
      const mergedMetadata = data.metadata || candidate;
      setMetadata(mergedMetadata);
      setTitleValue(mergedMetadata.title || item?.title || "");
      setAuthorValue((mergedMetadata.authors || []).join(", ") || item?.author || "");
      setDescription(mergedMetadata.description || "");
      setSeries(mergedMetadata.series || "");
      setSeriesIndex(mergedMetadata.seriesIndex || "");
      setArtwork(options);
      setSelectedArtwork(options.find((option) => option.exactEdition) || options[0] || (candidate.poster ? { url: candidate.poster, source: sourceLabel(candidate.provider), label: "Matched edition" } : null));
      setStatus("review");
      setMessage(options.length ? `${options.length} cover option${options.length === 1 ? "" : "s"} found.` : "No provider cover was found. You can upload one or confirm without changing the current cover.");
    } catch (error) {
      setMetadata(candidate);
      setTitleValue(candidate.title || item?.title || "");
      setAuthorValue((candidate.authors || []).join(", ") || item?.author || "");
      setDescription(candidate.description || "");
      setSeries(candidate.series || "");
      setSeriesIndex(candidate.seriesIndex || "");
      setArtwork(candidate.poster ? [{ url: candidate.poster, source: sourceLabel(candidate.provider), label: "Matched edition" }] : []);
      setSelectedArtwork(candidate.poster ? { url: candidate.poster, source: sourceLabel(candidate.provider), label: "Matched edition" } : null);
      setStatus("review");
      setMessage(error.message || "Alternate artwork could not be loaded.");
    }
  }

  function addUploadedArtwork(file) {
    if (!file) return;
    if (!/^image\/(?:jpeg|png|webp|gif)$/i.test(file.type || "")) {
      setMessage("Choose a JPEG, PNG, WebP, or GIF image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const option = { dataUrl: reader.result, url: reader.result, source: "Uploaded", label: file.name || "Uploaded cover", uploaded: true };
      setArtwork((current) => [option, ...current]);
      setSelectedArtwork(option);
      setMessage("Uploaded cover selected. It will be stored locally when you confirm.");
    };
    reader.onerror = () => setMessage("That image could not be read.");
    reader.readAsDataURL(file);
  }

  function addManualArtworkUrl() {
    const url = text(manualUrl);
    if (!/^https?:\/\//i.test(url)) {
      setMessage("Enter a complete HTTP or HTTPS image URL.");
      return;
    }
    const option = { url, source: "Manual URL", label: "Manually supplied cover" };
    setArtwork((current) => [option, ...current]);
    setSelectedArtwork(option);
    setManualUrl("");
  }

  async function enhanceFromWebpage() {
    const url = text(referenceUrl);
    if (!/^https?:\/\//i.test(url)) {
      setMessage("Enter a complete publisher or reference webpage URL.");
      return;
    }
    setStatus("artwork-loading");
    setMessage("Reading structured metadata from the webpage…");
    try {
      const response = await fetch("/api/books/metadata/webpage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.message || "The webpage could not be read.");
      const page = data.metadata || {};
      setMetadata((current) => ({
        ...(current || selected || {}),
        publisher: page.publisher || current?.publisher || "",
        publishedDate: page.publishedDate || current?.publishedDate || "",
        referenceSources: [...(current?.referenceSources || []).filter((entry) => entry?.url !== page.sourceUrl), { label: page.sourceHost || "Reference website", url: page.sourceUrl, reviewedAt: new Date().toISOString() }],
      }));
      if (page.description) setDescription((current) => page.description.length > current.length ? page.description : current);
      if (page.series) setSeries(page.series);
      if (page.seriesIndex) setSeriesIndex(page.seriesIndex);
      if (page.image) {
        const option = { url: page.image, source: page.sourceHost || "Reference website", label: "Webpage cover artwork" };
        setArtwork((current) => current.some((entry) => entry.url === option.url) ? current : [option, ...current]);
      }
      setStatus("review");
      setMessage(`Metadata suggestions loaded from ${page.sourceHost || "the webpage"}. Review the fields before saving.`);
    } catch (error) {
      setStatus("review");
      setMessage(error.message || "The webpage could not be read.");
    }
  }

  async function confirmFixedMatch() {
    if (!metadata || !item) return;
    setStatus("saving");
    setMessage("Saving the fixed match and local artwork…");
    try {
      let localArtwork = null;
      if ((selectedArtwork?.url || selectedArtwork?.dataUrl) && !selectedArtwork?.preservedLocal) {
        const artworkResponse = await fetch("/api/books/artwork/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            localId: bookLocalId(item),
            url: selectedArtwork.dataUrl ? undefined : selectedArtwork.url,
            dataUrl: selectedArtwork.dataUrl || undefined,
          }),
        });
        const artworkData = await artworkResponse.json();
        if (!artworkResponse.ok || artworkData.ok === false) throw new Error(artworkData.message || "The selected artwork could not be saved.");
        localArtwork = artworkData;
      }

      const poster = localArtwork?.publicUrl || selectedArtwork?.url || metadata.poster || item.poster || "";
      const authors = text(authorValue).split(/\s*,\s*/).filter(Boolean);
      const matchPayload = {
        ...metadata,
        status: "matched",
        source: metadata.provider || metadata.source || "openlibrary",
        providerId: metadata.providerId || metadata.id || null,
        title: text(titleValue) || metadata.title || item.title || "Untitled",
        sortTitle: text(titleValue) || metadata.sortTitle || metadata.title || item.title || "Untitled",
        authors: authors.length ? authors : metadata.authors || [],
        description: text(description),
        series: text(series),
        seriesIndex: text(seriesIndex),
        poster,
        cover: poster,
        gridPoster: poster,
        detailPoster: poster,
        fixedMatch: true,
        matchLocked: true,
        artworkOverrides: poster ? { gridPoster: poster, detailPoster: poster, cover: poster } : {},
        selectedArtwork: selectedArtwork ? {
          source: selectedArtwork.source || "",
          label: selectedArtwork.label || "",
          isbn: selectedArtwork.isbn || "",
          editionId: selectedArtwork.editionId || "",
          sourceUrl: selectedArtwork.dataUrl ? "" : selectedArtwork.url || "",
          localUrl: localArtwork?.publicUrl || "",
          savedAt: localArtwork?.savedAt || new Date().toISOString(),
        } : null,
        match: {
          ...(metadata.match || {}),
          query,
          confidence: 100,
          fixed: true,
          matchedAt: new Date().toISOString(),
        },
      };
      const response = await fetch("/api/metadata/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          libraryType: "books",
          localId: bookLocalId(item),
          metadata: matchPayload,
          manualOverride: true,
          matchSource: "admin-fixed-match",
          localItem: {
            id: item.id || null,
            localId: bookLocalId(item),
            title: item.title || "",
            path: item.path || item.filePath || item.folderPath || item.sourcePath || "",
            poster: item.poster || "",
            originalItem: item.originalItem || null,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.message || "The fixed match could not be saved.");
      window.dispatchEvent(new CustomEvent("homestead-metadata-match-updated", { detail: { library: "books", localId: bookLocalId(item) } }));
      onSaved?.(data.match);
      onClose?.();
    } catch (error) {
      setStatus("review");
      setMessage(error.message || "The fixed match could not be saved.");
    }
  }

  if (!item || typeof document === "undefined") return null;
  const review = metadata || selected;
  return createPortal(
    <div className="book-match-v2-overlay" role="dialog" aria-modal="true" aria-label="Fix book match and artwork" onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose?.(); }}>
      <section className="book-match-v2-modal" onClick={(event) => event.stopPropagation()}>
        <header className="book-match-v2-header">
          <div>
            <p className="eyebrow">Administrator Fixed Match</p>
            <h2>{editingExisting ? "Edit Book Metadata" : status === "review" || status === "saving" ? "Fix Match & Artwork" : "Choose the Exact Edition"}</h2>
            <span>{item.title}{item.author ? ` · ${item.author}` : ""}</span>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>Close</button>
        </header>

        {status !== "review" && status !== "saving" && (
          <div className="book-match-v2-search">
            <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") search(); }} placeholder="Title, author, or ISBN" autoFocus />
            <select value={provider} onChange={(event) => { setProvider(event.target.value); search(query, event.target.value); }}>
              <option value="all">All sources</option>
              <option value="openlibrary">Open Library editions</option>
              <option value="googlebooks">Google Books editions</option>
            </select>
            <button className="primary-button" type="button" disabled={status === "searching"} onClick={() => search()}>{status === "searching" ? "Searching…" : "Search"}</button>
          </div>
        )}

        {message && <div className={`book-match-v2-message ${status === "error" ? "error" : ""}`}>{message}</div>}

        {(status === "results" || status === "searching" || status === "error") && (
          <div className="book-match-v2-results">
            {results.map((candidate) => (
              <article className="book-match-v2-result" key={resultKey(candidate)}>
                <div className="book-match-v2-result-poster">{candidate.poster ? <img src={candidate.poster} alt="" /> : <span>📚</span>}</div>
                <div>
                  <h3>{candidate.title}</h3>
                  {candidate.subtitle && <p>{candidate.subtitle}</p>}
                  <strong>{(candidate.authors || []).join(", ") || "Unknown author"}</strong>
                  <div className="book-match-v2-pills">
                    <span>{sourceLabel(candidate.provider)}</span>
                    <span>{candidate.recordType === "edition" ? "Edition" : "Work"}</span>
                    {candidate.year && <span>{candidate.year}</span>}
                    {candidate.publisher && <span>{candidate.publisher}</span>}
                    {isbnFor(candidate) && <span>ISBN {isbnFor(candidate)}</span>}
                    {candidate.languages?.[0] && <span>{candidate.languages[0]}</span>}
                  </div>
                  {candidate.description && <p className="book-match-v2-snippet">{candidate.description}</p>}
                  <button className="primary-button" type="button" onClick={() => reviewCandidate(candidate)}>Review Match & Artwork</button>
                </div>
              </article>
            ))}
          </div>
        )}

        {(status === "artwork-loading") && <div className="book-match-v2-loading">Fetching the exact edition, synopsis, and alternate covers…</div>}

        {(status === "review" || status === "saving") && review && (
          <div className="book-match-v2-review">
            <aside>
              <div className="book-match-v2-selected-cover">
                {selectedArtwork?.url ? <img src={selectedArtwork.url} alt="Selected book cover" /> : <span>No cover selected</span>}
              </div>
              <label className="secondary-button book-match-v2-upload">Upload Cover<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { addUploadedArtwork(event.target.files?.[0]); event.target.value = ""; }} /></label>
              <div className="book-match-v2-url"><input value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} placeholder="Direct image or webpage URL" /><button className="secondary-button" type="button" onClick={addManualArtworkUrl}>Use URL</button></div>
            </aside>
            <main>
              <button className="book-match-v2-back" type="button" onClick={() => { setEditingExisting(false); setStatus("results"); setMessage(""); if (!results.length) search(query, provider); }}>← Change Edition / Match</button>
              <h3>{titleValue || review.title}</h3>
              <p className="book-match-v2-byline">{authorValue || (review.authors || []).join(", ") || "Unknown author"}</p>
              <div className="book-match-v2-pills">
                {series && <span>{series}{seriesIndex ? ` #${seriesIndex}` : ""}</span>}
                {review.publisher && <span>{review.publisher}</span>}
                {review.publishedDate && <span>{review.publishedDate}</span>}
                {isbnFor(review) && <span>ISBN {isbnFor(review)}</span>}
                {review.pageCount && <span>{review.pageCount} pages</span>}
              </div>
              <div className="book-match-v2-reference-source"><input value={referenceUrl} onChange={(event) => setReferenceUrl(event.target.value)} placeholder="Official publisher or reference webpage URL" /><button className="secondary-button" type="button" onClick={enhanceFromWebpage}>Enhance from Webpage</button></div>
              <section className="book-match-v2-metadata-fields" aria-label="Book metadata to save">
                <label>
                  <span>Title</span>
                  <input value={titleValue} onChange={(event) => setTitleValue(event.target.value)} placeholder="Book title" />
                </label>
                <label>
                  <span>Author</span>
                  <input value={authorValue} onChange={(event) => setAuthorValue(event.target.value)} placeholder="Author name" />
                </label>
                <label>
                  <span>Series</span>
                  <input value={series} onChange={(event) => setSeries(event.target.value)} placeholder="Series name (optional)" />
                </label>
                <label>
                  <span>Book number</span>
                  <input value={seriesIndex} onChange={(event) => setSeriesIndex(event.target.value)} placeholder="For example, 6" />
                </label>
                <label className="book-match-v2-description-field">
                  <span>Description</span>
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="No provider synopsis was found. You can enter one here before saving." rows="6" />
                </label>
              </section>
              <div className="book-match-v2-artwork-heading"><strong>Choose cover artwork</strong><span>{artwork.length} options from matching editions</span></div>
              <div className="book-match-v2-artwork-grid">
                {artwork.map((option, index) => (
                  <button className={selectedArtwork === option ? "selected" : ""} type="button" key={`${option.source}-${option.coverId || option.editionId || index}`} onClick={() => setSelectedArtwork(option)}>
                    <img src={option.url} alt="" />
                    <span><strong>{option.exactEdition ? "Exact edition cover" : option.source || "Cover"}</strong><small>{option.label || option.isbn || "Alternate cover"}</small></span>
                  </button>
                ))}
              </div>
              <footer>
                <span>Metadata, series, and cover are saved together as one app-wide fixed match. Choosing a cover does not replace the selected edition metadata.</span>
                <button className="primary-button" type="button" disabled={status === "saving"} onClick={confirmFixedMatch}>{status === "saving" ? "Saving…" : editingExisting ? "Save Changes" : "Confirm Fixed Match"}</button>
              </footer>
            </main>
          </div>
        )}
      </section>
    </div>,
    document.body
  );
}
