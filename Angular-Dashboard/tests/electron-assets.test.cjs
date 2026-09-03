// Run after `npm run build`: verify assets resolve with Electron's file:// URL.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');

test('built login background resolves under file:// and matches the source image', () => {
  const project = path.resolve(__dirname, '..');
  const output = path.join(project, 'dist', 'angular-dashboard', 'browser');
  const index = readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.match(index, /<base href="\.\/">/);
  const cssHref = index.match(/href="([^"<>]*styles[^"<>]*\.css)"/);
  assert.ok(cssHref, 'built index must reference the stylesheet');
  const cssUrl = new URL(cssHref[1], pathToFileURL(path.join(output, 'index.html')));
  const css = readFileSync(fileURLToPath(cssUrl), 'utf8');
  const rule = css.match(/\.login-page\{([^}]+)\}/);
  assert.ok(rule, 'login page style must be present');
  const background = rule[1].match(/url\(["']?([^"')]+)["']?\)/);
  assert.ok(background, 'login page must have a background image');
  assert.doesNotMatch(background[1], /^(\/|[a-z][a-z+.-]*:)/i, 'image URL must be relative');
  const imagePath = fileURLToPath(new URL(background[1], cssUrl));
  assert.ok(imagePath.startsWith(output + path.sep), 'image must stay inside the packaged app');
  const image = readFileSync(imagePath);
  assert.deepEqual(image, readFileSync(path.join(project, 'public', 'images', 'medical-login-background.png')));
});
