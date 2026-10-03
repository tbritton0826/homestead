import fs from "fs";
import path from "path";

const celebrityName = process.argv.slice(2).join(" ");

if (!celebrityName) {
  console.log("Usage: node scripts/fetch-celebrity-metadata.js Taylor Swift");
  process.exit(1);
}

const slug = celebrityName.toLowerCase().replaceAll(" ", "-");

const candidates = {
  name: celebrityName,
  library: "celebrities",
  generatedAt: new Date().toISOString(),

  metadataCandidates: {
    birthday: "",
    height: "",
    weight: "",
    braSize: "",
    pantySize: "",
    hairColor: "",
    eyeColor: "",
    occupation: "",
    notes: ""
  },

  referenceLinks: [
    {
      label: "Wikipedia Search",
      url: `https://www.google.com/search?q=${encodeURIComponent(celebrityName + " Wikipedia")}`
    },
    {
      label: "Body Measurements Search",
      url: `https://www.google.com/search?q=${encodeURIComponent(celebrityName + " body measurements bra size height weight")}`
    },
    {
      label: "Images Search",
      url: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(celebrityName + " photoshoot")}`
    }
  ]
};

const folder = path.join(
  "media",
  "celebrities",
  slug
);

fs.mkdirSync(folder, { recursive: true });

fs.writeFileSync(
  path.join(folder, "metadata-candidates.json"),
  JSON.stringify(candidates, null, 2)
);

console.log(`Created metadata candidates for ${celebrityName}`);
console.log(`Saved to ${folder}/metadata-candidates.json`);