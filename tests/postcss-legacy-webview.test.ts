import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import postcss from 'postcss';

const require = createRequire(import.meta.url);
const legacyWebview = require('../scripts/postcss-legacy-webview.cjs');
const legacyWhere = require('../scripts/postcss-legacy-where.cjs');

const run = async (plugin: () => postcss.Plugin, css: string) =>
  (await postcss([plugin()]).process(css, { from: undefined })).css;

// Generated nodes copy the input's formatting, so compare the fallback plugin's output without whitespace
const runCompact = async (css: string) => (await run(legacyWebview, css)).replace(/\s+/g, '');

test('individual transform properties get a transform fallback behind @supports', async () => {
  const css = await runCompact('.scale-105{--tw-scale-x:105%;--tw-scale-y:105%;scale:var(--tw-scale-x) var(--tw-scale-y)}');
  assert.match(css, /@supportsnot\(translate:0\)\{\.scale-105\{/);
  assert.match(css, /--tw-scale-x:1\.05/);
  assert.match(css, /transform:translate\(var\(--tw-translate-x,0\)/);
});

test('literal rotate maps to the legacy rotate variable', async () => {
  const css = await runCompact('.-rotate-90{rotate:-90deg}');
  assert.match(css, /--tw-legacy-rotate:-90deg/);
});

test('aspect-ratio gets a padding-top ratio box behind @supports', async () => {
  const css = await runCompact('.aspect-\\[2\\/3\\]{aspect-ratio:2/3}');
  assert.match(css, /@supportsnot\(aspect-ratio:1\)/);
  assert.match(css, /::before\{[^}]*padding-top:calc\(100%\/\(2\/3\)\)/);
});

test("Tailwind's @property fallback block also applies without individual transforms", async () => {
  const css = await runCompact('@supports ((-webkit-hyphens:none) and (not (margin-trim:inline))){*,::before{--tw-scale-x:1}}');
  assert.match(css, /or\(not\(translate:0\)\)/);
  assert.match(css, /--tw-legacy-rotate:0deg/);
});

test(':where() rules are repeated without :where() under html.legacy-css', async () => {
  const css = await run(legacyWhere, ':where(.space-y-2>:not(:last-child)){margin-top:8px}');
  assert.match(css, /^:where\(/);
  assert.match(css, /\.legacy-css \.space-y-2>:not\(:last-child\)\s*\{margin-top:8px\}/);
});

test(':where() selector lists expand into one selector each, keeping escapes intact', async () => {
  const css = await run(legacyWhere, 'input:where([type=button],[type="a,b"]) .x\\(y\\){color:red}');
  assert.match(css, /\.legacy-css input\[type=button\] \.x\\\(y\\\)/);
  assert.match(css, /\.legacy-css input\[type="a,b"\] \.x\\\(y\\\)/);
});

test('GPU-layer transform hints are not repeated', async () => {
  const css = await run(legacyWhere, 'nav:where(.fixed){transform:translateZ(0)}');
  assert.doesNotMatch(css, /legacy-css/);
});

test(':where() arguments with combinators are dropped when attached to a compound', async () => {
  const css = await run(legacyWhere, '.dark\\:x:where(.dark, .dark *){color:red}');
  assert.match(css, /\.legacy-css \.dark\\:x\.dark\{/);
  assert.doesNotMatch(css, /legacy-css[^{]*\.dark \*/);
});

test('copies whose :not() takes a selector list are dropped, old Chrome rejects them', async () => {
  const css = await run(legacyWhere, '.x:where(:not(.a, .b)){color:red}');
  assert.doesNotMatch(css, /legacy-css/);
});

test('root selectors get the legacy class attached instead of a descendant prefix', async () => {
  const css = await run(legacyWhere, 'html:where(.dark) .x{color:red}');
  assert.match(css, /html\.legacy-css\.dark \.x\{/);
});
