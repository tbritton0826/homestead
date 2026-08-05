const fs = require("fs");
const path = require("path");

const DATA_PATH = "/app/data/media-index.json";
const SETUP_PATH = "/app/data/setup-config.json";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function cleanTitle(name) {
  return name.replace(/\(\d{4}\)/, "").trim();
}

function extractYear(name) {
  return name.match(/\((\d{4})\)/)?.[1] || "";
}

function getShowFolder(show) {
  const firstPath = show.files?.[0]?.sourcePath || "";

  if (!firstPath) return "";

  const normalized = firstPath.replaceAll("\\", "/");
  const parts = normalized.split("/");

  const seasonIndex = parts.findIndex((part) =>
    /^season[\s._-]*\d+$/i.test(part)
  );

  if (seasonIndex !== -1) {
    return parts.slice(0, seasonIndex).join("/");
  }

  return path.dirname(firstPath);
}

async function seerrFetch(endpoint) {
  const setup = readJson(SETUP_PATH);
  const seerr =
    setup.integrationSettings?.jellyseerr ||
    setup.integrationSettings?.seerr;

  if (!seerr?.url || !seerr?.apiKey) {
    throw new Error("Missing Jellyseerr URL or API key");
  }

  const baseUrl = seerr.url.replace(/\/$/, "");

  const res = await fetch(`${baseUrl}${endpoint}`, {
    headers: {
      "X-Api-Key": seerr.apiKey,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || `Seerr error ${res.status}`);
  }

  return data;
}

async function downloadImage(url, outputPath) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed image download: ${url}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

async function fetchTVMetadata(show) {
  const title = cleanTitle(show.name);
  const year = extractYear(show.name);

  console.log(`Searching TV: ${title} ${year}`);

  const showFolder = getShowFolder(show);

  if (!showFolder) {
    console.log(`No source folder for: ${show.name}`);
    return;
  }

  const existingMetadataPath = path.join(showFolder, "metadata.json");
  const existingMetadata = fs.existsSync(existingMetadataPath)
    ? readJson(existingMetadataPath)
    : {};

  let tmdbId = existingMetadata.tmdbId || existingMetadata.id || null;

  if (!tmdbId) {
    const search = await seerrFetch(
      `/api/v1/search?query=${encodeURIComponent(title)}`
    );

    const match = search.results?.find((item) => {
      const itemYear = item.firstAirDate?.slice(0, 4);
      return item.mediaType === "tv" && (!year || itemYear === year);
    });

    if (!match) {
      console.log(`No TV match found: ${show.name}`);
      return;
    }

    tmdbId = match.id;
  } else {
    console.log(`Using override TMDB ID for ${show.name}: ${tmdbId}`);
  }

  const details = await seerrFetch(`/api/v1/tv/${tmdbId}`);

  const metadata = {
    title: details.name,
    year: details.firstAirDate?.slice(0, 4) || "",
    tmdbId: details.id,
    overview: details.overview || "",
    firstAirDate: details.firstAirDate || "",
    status: details.status || "",
    genres: details.genres?.map((g) => g.name) || [],
    rating: details.voteAverage || null,
    seasons:
      details.seasons?.map((season) => ({
        seasonNumber: season.seasonNumber,
        name: season.name,
        overview: season.overview || "",
        episodeCount: season.episodeCount || 0,
        airDate: season.airDate || "",
        posterPath: season.posterPath || "",
      })) || [],
    source: "jellyseerr",
    fetchedAt: new Date().toISOString(),
  };

  writeJson(path.join(showFolder, "metadata.json"), metadata);

  if (details.posterPath) {
    await downloadImage(
      `https://image.tmdb.org/t/p/w500${details.posterPath}`,
      path.join(showFolder, "poster.jpg")
    );
  }

  if (details.backdropPath) {
    await downloadImage(
      `https://image.tmdb.org/t/p/original${details.backdropPath}`,
      path.join(showFolder, "banner.jpg")
    );
  }

  console.log(`Saved TV metadata/artwork: ${show.name}`);
}
async function main() {
  const index = readJson(DATA_PATH);
  const shows = Object.values(index.libraries?.tv || {});

  for (const show of shows) {
    if (!show.files?.length) continue;

    try {
      await fetchTVMetadata(show);
    } catch (error) {
      console.error(`Failed: ${show.name}`, error.message);
    }
  }
}

main();