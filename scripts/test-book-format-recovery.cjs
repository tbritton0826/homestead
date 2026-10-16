const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { relatedBookRecords, registerBookLocalFiles } = require('../src/server/book-local-files.cjs');
const express = require('express');
const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');

function scannerFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-book-formats-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scannerSource = serverSource.slice(serverSource.indexOf('const BOOK_EBOOK_EXTENSIONS ='), serverSource.indexOf('function reconcileNestedBooksMediaIndex()'));
  const scan = vm.runInNewContext(scannerSource + '\nscanNestedBooksLibrary', {
    fs: { ...fs, statSync: target => {
      assert.equal(path.resolve(target), directory, 'the scanner fixture may only access its generated root');
      return fs.statSync(target);
    } }, path, crypto, readSetupConfig: () => ({ folderMappings: { books: [directory] } }),
    normalizeFolderList: value => Array.isArray(value) ? value : value ? [value] : [],
  });
  function write(relative) {
    const absolute = path.join(directory, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, 'generated test fixture');
    return absolute;
  }
  return { directory, scan, write };
}

test('the actual scanner preserves all 15 audio parts beside root and ebook-subfolder editions with a shared cached ID', t => {
  const { directory, scan, write } = scannerFixture(t);
  const folder = path.join(directory, 'Cassandra Clare', 'City of Bones');
  const ebook = write('Cassandra Clare/City of Bones/City of Bones.epub');
  const pdf = write('Cassandra Clare/City of Bones/ebook/City of Bones.pdf');
  const parts = Array.from({ length: 15 }, (_, i) => write(`Cassandra Clare/City of Bones/audiobook/City of Bones-Part${String(i + 1).padStart(2, '0')}.mp3`));
  const existing = { saved: { id: 'saved', title: 'City of Bones', folderPath: folder,
    metadata: { workId: 'preserved-work' }, counts: { total: 20 },
    files: [ebook, pdf, ...parts].map(file => ({ path: file })) } };
  const result = scan(existing, { force: true });
  const book = result.saved;
  assert.ok(book, 'preserve the indexed book identity');
  assert.equal(Object.keys(result).length, 1, 'format folders are one book');
  assert.equal(book.folderPath, folder);
  assert.equal(book.counts.audiobooks, 15);
  assert.equal(book.counts.ebooks, 2);
  assert.equal(book.metadata.workId, 'preserved-work');
  assert.deepEqual(Array.from(book.files.filter(file => file.type === 'audiobook'), file => file.path), parts);
  assert.equal(scan(existing), result, 'warm-cache lookup preserves audio too');
  assert.equal(relatedBookRecords({ books: result }, 'saved')[0].files.length, 17);
});

test('format discovery works from a cold index and never combines identical titles in different author folders', t => {
  const { scan, write } = scannerFixture(t);
  for (const author of ['First Author', 'Second Author']) {
    write(`${author}/Same Book/ebook/Same Book.epub`);
    write(`${author}/Same Book/audiobook/Part01.MP3`);
  }
  const result = scan({}, { force: true });
  assert.equal(Object.keys(result).length, 2);
  for (const book of Object.values(result)) {
    assert.equal(book.files.length, 2);
    assert.equal(book.counts.audiobooks, 1);
    assert.equal(relatedBookRecords({ books: result }, book.id).length, 1);
  }
});

test('legacy sibling ebook/audio records resolve only inside the same identifiable book folder', () => {
  const book = { id: 'read', title: 'City of Bones', folderPath: '/books/Author/City of Bones/ebook' };
  const audio = { id: 'listen', title: 'audiobook', folderPath: '/books/Author/City of Bones/audiobook' };
  const unrelated = { ...audio, id: 'other', folderPath: '/books/Another/City of Bones/audiobook' };
  assert.deepEqual(relatedBookRecords({ books: { book }, audiobooks: { audio, unrelated } }, 'read'), [book, audio]);
});

test('format endpoint returns discovered audio for the selected authorized identity; it cannot authorize guessed folders', async t => {
  const { scan, write } = scannerFixture(t);
  const ebook = write('Author/City of Bones/ebook/Book.epub');
  write('Author/City of Bones/audiobook/Part01.mp3');
  const records = scan({ known: { id: 'known', title: 'City of Bones', files: [{ path: ebook }] } }, { force: true });
  const app = express();
  registerBookLocalFiles(app, { requireSession: (_, __, next) => next(), authorizedIndex: () => ({ books: records }) });
  const listener = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => { listener.closeAllConnections(); listener.close(resolve); }));
  const url = `http://127.0.0.1:${listener.address().port}/api/books/local-files`;
  const response = await fetch(url + '?recordId=books:known');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).records[0].files.filter(file => file.type === 'audiobook').length, 1);
  assert.equal((await fetch(url + '?recordId=hidden&folder=' + encodeURIComponent(path.dirname(ebook)))).status, 404);
});

test('web Listen publishes an ordered audio queue, closes the book overlay and explicitly opens the player without Read Along', () => {
  const start = appSource.indexOf('  const listenToBook =');
  const end = appSource.indexOf('\n  if (false && selectedBook)', start);
  const events = [];
  const listen = vm.runInNewContext('(function(){' + appSource.slice(start, end) + ';return listenToBook;})()', {
    selectedBook: null, setGlobalAudioTrack: track => events.push(['play', track]),
    setSelectedBook: value => events.push(['detail', value]), readableEbooks: book => book.ebookFiles,
  });
  listen({ id: 'book', title: 'Book', author: 'Author', ebookFiles: [{ path: '/book.epub' }],
    audiobookFiles: [{ name: 'Part01.mp3', path: '/Part01.mp3' }, { name: 'Part02.mp3', path: '/Part02.mp3' }] });
  assert.equal(events[0][1].playbackQueue.length, 2);
  assert.equal(events[0][1].path, '/Part01.mp3');
  assert.equal(events[0][1].openPlayer, true);
  assert.deepEqual(events[1], ['detail', null], 'the detail overlay must not cover the lower-z-index player');
});

test('the actual global player opens on a Listen request and leaves Read Along opt-in', async () => {
  const { transformWithOxc } = await import('vite');
  const start = appSource.indexOf('function GlobalAudioPlayer(');
  const end = appSource.indexOf('\n}', start) + 2;
  const compiled = await transformWithOxc(appSource.slice(start, end), 'player.jsx', { jsx: { runtime: 'classic' } });
  function render(track) {
    const values = [], effects = [];
    const Player = vm.runInNewContext(compiled.code + ';GlobalAudioPlayer', {
      React: require('react'), useRef: () => ({ current: null }),
      useState: initial => { const slot = values.length; values.push(initial); return [initial, next => { values[slot] = next; }]; },
      useEffect: effect => effects.push(effect), navigator: {}, getPlayableMediaUrl: file => file?.path || '', readableEbooks: () => [],
    });
    Player({ track, onClose() {}, onTrackChange() {} });
    for (const effect of effects) effect();
    return values;
  }
  const audiobook = render({ path: '/Part01.mp3', type: 'audiobook', openPlayer: true });
  assert.equal(audiobook[0], true, 'Listen opens the existing player');
  assert.equal(audiobook[5], '', 'Read Along is not activated by Listen');
  assert.equal(render(null)[0], false);
  assert.equal(render({ path: '/song.mp3', type: 'music' })[0], false, 'music keeps its existing mini-player behavior');
});
