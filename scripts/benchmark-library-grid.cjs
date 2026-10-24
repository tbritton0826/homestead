// Client card-construction comparison against the pre-polish implementation.
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const React = require('react');
const { performance } = require('node:perf_hooks');
async function run() {
  const { transformWithOxc } = await import('vite');
  const sources = {
    before: execFileSync('git', ['show', '5bf8348:src/components/ProgressiveLibraryGrid.jsx'], { encoding: 'utf8' }),
    after: fs.readFileSync('src/components/ProgressiveLibraryGrid.jsx', 'utf8'),
  };
  const results = {};
  const items = Array.from({ length: 10000 }, (_, index) => ({ id: index, title: `Movie ${index}`, poster: '/fixture/poster.jpg' }));
  for (const [label, source] of Object.entries(sources)) {
    const code = (await transformWithOxc(source.replace(/import[^;]+;/, '').replace('export const', 'const').replace('export default function', 'function'), 'grid.jsx', { jsx: { runtime: 'classic' } })).code;
    const context = { React, useMemo: fn => fn(), useState: value => [value, () => {}], useRef: () => ({ current: null }), useEffect() {}, useLayoutEffect() {} };
    const Grid = vm.runInNewContext(code + ';ProgressiveLibraryGrid', context);
    const durations = []; let calls = 0;
    for (let attempt = 0; attempt < 7; attempt++) {
      calls = 0; const start = performance.now();
      Grid({ items, className: 'grid', libraryId: 'movies', getLetter: item => item.title[0], renderItem: item => { calls++; return React.createElement('button', { key: item.id }, React.createElement('img', { src: item.poster }), React.createElement('h3', null, item.title)); } });
      durations.push(performance.now() - start);
    }
    results[label] = { records: items.length, cardsConstructed: calls, medianMilliseconds: Number(durations.sort((a, b) => a - b)[3].toFixed(2)) };
  }
  console.log(JSON.stringify(results, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
