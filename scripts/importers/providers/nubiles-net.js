export async function importNubilesNet(performerName) {
  return {
    provider: "Nubiles-Net",
    searchedFor: performerName,
    status: "placeholder",
    searchUrl: `https://www.google.com/search?q=${encodeURIComponent(
      `site:nubiles.net "${performerName}"`
    )}`,
    referenceLinks: [
      {
        label: "Nubiles-Net Search",
        url: `https://www.google.com/search?q=${encodeURIComponent(
          `site:nubiles.net "${performerName}"`
        )}`,
      },
    ],
    scenes: [],
  };
}