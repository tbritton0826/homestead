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

async function fetchMovieMetadata(movie) {
  const title = cleanTitle(movie.name);
  const year = extractYear(movie.name);

  console.log(`Searching: ${title} ${year}`);

  const search = await seerrFetch(
    `/api/v1/search?query=${encodeURIComponent(title)}`
  );

  const match = search.results?.find((item) => {
    const itemYear = item.releaseDate?.slice(0, 4);
    return item.mediaType === "movie" && (!year || itemYear === year);
  });

  if (!match) {
    console.log(`No match found: ${movie.name}`);
    return;
  }

  const details = await seerrFetch(`/api/v1/movie/${match.id}`);

  const movieFolder = path.dirname(movie.files?.[0]?.sourcePath || "");

  if (!movieFolder) {
    console.log(`No source folder for: ${movie.name}`);
    return;
  }

  const metadata = {
    title: details.title,
    year: details.releaseDate?.slice(0, 4) || "",
    tmdbId: details.id,
    overview: details.overview || "",
    tagline: details.tagline || "",
    runtime: details.runtime || null,
    releaseDate: details.releaseDate || "",
    genres: details.genres?.map((g) => g.name) || [],
    rating: details.voteAverage || null,
    source: "jellyseerr",
    fetchedAt: new Date().toISOString(),
  };

  writeJson(path.join(movieFolder, "metadata.json"), metadata);

  if (details.posterPath) {
    await downloadImage(
      `https://image.tmdb.org/t/p/w500${details.posterPath}`,
      path.join(movieFolder, "poster.jpg")
    );
  }

  if (details.backdropPath) {
    await downloadImage(
      `https://image.tmdb.org/t/p/original${details.backdropPath}`,
      path.join(movieFolder, "banner.jpg")
    );
  }

  console.log(`Saved metadata/artwork: ${movie.name}`);
}

async function main() {
  const index = readJson(DATA_PATH);
  const movies = Object.values(index.libraries?.movies || {});

  for (const movie of movies) {
    if (!movie.files?.length) continue;

    try {
      await fetchMovieMetadata(movie);
    } catch (error) {
      console.error(`Failed: ${movie.name}`, error.message);
    }
  }
}

main();