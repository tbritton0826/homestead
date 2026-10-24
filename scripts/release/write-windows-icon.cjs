const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

async function writeWindowsIcon(source, destination) {
  const png = await sharp(source).resize(256, 256).png().toBuffer();
  // ICO supports a PNG payload; zero width/height bytes denote 256 pixels.
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, Buffer.concat([header, png]));
}

if (require.main === module) writeWindowsIcon(process.argv[2], process.argv[3]).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { writeWindowsIcon };
