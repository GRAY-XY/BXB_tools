import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const coreRoot = path.dirname(require.resolve('playwright-core/package.json'));
const manifest = JSON.parse(readFileSync(path.join(coreRoot, 'browsers.json'), 'utf8'));
const revision = manifest.browsers.find(browser => browser.name === 'chromium').revision;
const installs = new Map();

export function chromiumExecutableCandidates(root, options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const folder = path.join(root, `chromium-${options.revision ?? revision}`);
  if (platform === 'darwin') {
    const suffix = arch === 'arm64' ? 'chrome-mac-arm64' : 'chrome-mac-x64';
    return [
      path.join(folder, suffix, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
      path.join(folder, suffix, 'Chromium.app/Contents/MacOS/Chromium'),
      path.join(folder, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
    ];
  }
  if (platform === 'win32') return [path.join(folder, 'chrome-win64/chrome.exe'), path.join(folder, 'chrome-win/chrome.exe')];
  return [path.join(folder, 'chrome-linux64/chrome'), path.join(folder, 'chrome-linux/chrome')];
}

export function findChromiumExecutable(roots, options = {}) {
  const platform = options.platform ?? process.platform;
  for (const root of roots.filter(Boolean)) {
    for (const file of chromiumExecutableCandidates(root, options)) {
      try {
        if (!statSync(file).isFile()) continue;
        accessSync(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return file;
      } catch { /* A missing/incomplete/incompatible cache is not ready. */ }
    }
  }
  return null;
}

export function nativeBrowserCacheCandidates(appDataRoot, options = {}) {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const cache = platform === 'darwin' ? path.join(home, 'Library/Caches/ms-playwright')
    : platform === 'win32' ? path.join(env.LOCALAPPDATA || path.join(home, 'AppData/Local'), 'ms-playwright')
    : path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'ms-playwright');
  const configured = env.PLAYWRIGHT_BROWSERS_PATH === '0' ? path.join(coreRoot, '.local-browsers') : env.PLAYWRIGHT_BROWSERS_PATH;
  return [...new Set([configured, appDataRoot && path.join(appDataRoot, 'ms-playwright'), cache].filter(Boolean))];
}

export function installChromium(root) {
  const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', '--no-shell', 'chromium'], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: root, PLAYWRIGHT_SKIP_BROWSER_GC: '1' },
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000,
    });
    // Consume installer output without corrupting the bridge's JSONL stdout.
    child.stdout.resume(); child.stderr.resume();
    child.once('error', () => reject(new Error('无法启动登录浏览器安装，请重新安装应用后重试。')));
    child.once('close', code => code === 0 ? resolve()
      : reject(new Error('登录浏览器下载未完成，请检查网络后重试。')));
  });
}

export async function prepareNativeChromium(options) {
  const ready = findChromiumExecutable(options.roots, options);
  if (ready) return ready;
  const key = [options.installRoot, options.platform ?? process.platform, options.arch ?? process.arch, options.revision ?? revision].join('|');
  if (!installs.has(key)) {
    const installing = (async () => {
      await (options.install ?? installChromium)(options.installRoot);
      const executable = findChromiumExecutable([options.installRoot], options);
      if (!executable) throw new Error('登录浏览器安装不完整，请检查网络后重试。');
      return executable;
    })();
    installs.set(key, installing);
  }
  const pending = installs.get(key);
  try { return await pending; }
  finally { if (installs.get(key) === pending) installs.delete(key); }
}
