import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// A wrong platform/revision or a directory-only readiness check must fail.
const runtime = await import('../src/playwright-runtime.js').catch(() => ({}));

test('Chromium resolution uses the requested platform, architecture and revision', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bxb-browser-path-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { platform: 'darwin', arch: 'arm64', revision: '7777' };
  const wrong = path.join(root, 'chromium-7777/chrome-win64/chrome.exe');
  const old = path.join(root, 'chromium-1111/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  for (const file of [wrong, old]) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'fixture', { mode: 0o755 }); }
  assert.equal(typeof runtime.findChromiumExecutable, 'function', 'runtime resolver is missing');
  assert.equal(runtime.findChromiumExecutable([root], options), null);
  const correct = path.join(root, 'chromium-7777/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  await fs.mkdir(path.dirname(correct), { recursive: true }); await fs.writeFile(correct, 'fixture', { mode: 0o755 });
  assert.equal(runtime.findChromiumExecutable([root], options), correct);
  assert.equal(runtime.findChromiumExecutable([root], { ...options, arch: 'x64' }), null);
  assert.equal(runtime.findChromiumExecutable([root], { ...options, platform: 'win32' }), wrong);
});

test('Mac cache candidates include the native Playwright user cache without Windows defaults', () => {
  assert.equal(typeof runtime.nativeBrowserCacheCandidates, 'function', 'native cache locator is missing');
  const roots = runtime.nativeBrowserCacheCandidates('/app/data', { homeDir: '/fixture-user', platform: 'darwin', env: {} });
  assert.deepEqual(roots, ['/app/data/ms-playwright', '/fixture-user/Library/Caches/ms-playwright']);
});

test('browser preparation shares an install and verifies its result before marking ready', async t => {
  assert.equal(typeof runtime.prepareNativeChromium, 'function', 'native browser preparation is missing');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bxb-browser-install-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let installs = 0; let release;
  const held = new Promise(r => { release = r; });
  const options = { roots: [root], installRoot: root, platform: 'darwin', arch: 'arm64', revision: '7777',
    install: async destination => {
      installs++; await held;
      const file = path.join(destination, 'chromium-7777/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'fixture', { mode: 0o755 });
    } };
  const first = runtime.prepareNativeChromium(options);
  const second = runtime.prepareNativeChromium(options);
  release();
  const [a,b] = await Promise.all([first,second]);
  assert.equal(a, b); assert.equal(installs, 1);
  assert.equal(a, path.join(root, 'chromium-7777/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
  assert.equal(await runtime.prepareNativeChromium(options), a); assert.equal(installs, 1);
});

test('failed or incomplete browser installs do not become a ready cache and can retry', async t => {
  assert.equal(typeof runtime.prepareNativeChromium, 'function', 'native browser preparation is missing');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bxb-browser-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { roots: [root], installRoot: root, platform: 'darwin', arch: 'arm64', revision: '7777' };
  await assert.rejects(runtime.prepareNativeChromium({ ...options, install: async () => { throw new Error('download failed'); } }));
  await assert.rejects(runtime.prepareNativeChromium({ ...options, install: async () => {} }), /浏览器/);
  assert.equal(runtime.findChromiumExecutable([root], options), null);
});
