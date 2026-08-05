export async function importTiny4K(performerName) {
  return {
    provider: "Tiny4K",
    searchedFor: performerName,
    status: "placeholder",
    searchUrl: `https://www.google.com/search?q=${encodeURIComponent(
      `https://tiny4k.com/ "${performerName}"`
    )}`,
    referenceLinks: [
      {
        label: "Tiny4K Search",
        url: `https://www.google.com/search?q=${encodeURIComponent(
          `https://tiny4k.com/ "${performerName}"`
        )}`,
      },
    ],
    scenes: [],
  };
}