import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const app = process.argv[2];
assert.ok(app, 'Pass the packaged app path');
const runtime = path.join(app, 'Contents/Resources/BXBRuntime');
const require = createRequire(path.join(runtime, 'package.json'));
const { chromium } = require('playwright');
const { prepareNativeChromium } = await import(pathToFileURL(path.join(runtime, 'backend/src/playwright-runtime.js')));
const root = process.argv[3] || await fs.mkdtemp(path.join(os.tmpdir(), 'bxb-packaged-browser-'));
// Change the root AFTER loading Playwright to catch its import-time cache path
// versus the app's runtime-selected install root. Launch must use the resolved executable.
process.env.PLAYWRIGHT_BROWSERS_PATH = root;
const executablePath = await prepareNativeChromium({ roots: [root], installRoot: root });
assert.ok(executablePath.startsWith(root + path.sep));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  await page.setContent('<title>BXB Packaged Browser Smoke</title>');
  assert.equal(await page.title(), 'BXB Packaged Browser Smoke');
  console.log('packaged-browser=ok project-revision runtime-selected-cache isolated-page');
} finally { if (browser) await browser.close(); }
