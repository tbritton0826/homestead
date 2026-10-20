const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

function createImagePreviewer(directory) {
  const pending = new Map();
  let active = 0;
  const waiting = [];
  return async function preview(file, options = {}) {
    const width = Math.max(128, Math.min(1600, Math.round(Number(options.width)) || 640));
    const quality = Math.max(40, Math.min(90, Number(options.quality) || 80));
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) throw Error('Not an image file.');
    const key = crypto.createHash('sha256').update(JSON.stringify([path.resolve(file), stat.size, stat.mtimeMs, width, quality])).digest('hex');
    const destination = path.join(directory, key + '.jpg');
    if (fs.existsSync(destination)) return destination;
    if (pending.has(key)) return pending.get(key);
    if (waiting.length >= 64) throw Error('Image previews are busy. Retry shortly.');
    const work = (async () => {
      if (active >= 2) await new Promise(resolve => waiting.push(resolve));
      else active++;
      const temporary = destination + '.' + crypto.randomUUID() + '.tmp';
      try {
        await fs.promises.mkdir(directory, { recursive: true });
        await sharp(file, { pages: 1, limitInputPixels: 100000000 }).rotate()
          .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#101725' }).jpeg({ quality, progressive: true }).toFile(temporary);
        await fs.promises.rename(temporary, destination);
        return destination;
      } finally {
        await fs.promises.rm(temporary, { force: true }).catch(() => {});
        if (waiting.length) waiting.shift()(); else active--;
      }
    })().finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  };
}
module.exports = { createImagePreviewer };
