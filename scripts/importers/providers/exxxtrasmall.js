export async function importExxxtraSmall(performerName) {
  return {
    provider: "ExxxtraSmall",
    searchedFor: performerName,
    status: "placeholder",
    searchUrl: `https://www.google.com/search?q=${encodeURIComponent(
      `site:exxxtrasmall.com "${performerName}"`
    )}`,
    referenceLinks: [
      {
        label: "ExxxtraSmall Search",
        url: `https://www.google.com/search?q=${encodeURIComponent(
          `site:exxxtrasmall.com "${performerName}"`
        )}`,
      },
    ],
    scenes: [],
  };
}