// Общий помощник для проверок через headless Chromium (Playwright).
// Браузер берётся из /opt/pw-browsers (скачивать ничего не нужно).
import { chromium } from 'playwright-core';

export const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';

export async function launch(opts = {}) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--use-gl=angle',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--disable-dev-shm-usage',
      ...(opts.args || []),
    ],
  });
  return browser;
}

export async function openPage(browser, url, { width = 1280, height = 720, log = true, deviceScaleFactor = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') {
      errors.push(`[${t}] ${m.text()}`);
      if (log) console.log(`[browser ${t}]`, m.text());
    } else if (log && process.env.VERBOSE) console.log('[browser]', m.text());
  });
  page.on('pageerror', (e) => {
    errors.push(`[pageerror] ${e.message}`);
    if (log) console.log('[pageerror]', e.message, e.stack ? '\n' + e.stack.split('\n').slice(0, 6).join('\n') : '');
  });
  await page.goto(url, { waitUntil: 'load' });
  return { page, ctx, errors };
}
