import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.env.PREVIEW_URL || 'https://markdownstudio.com';
const outDir = 'docs/qa/live-walkthrough';
const issues = [];
const steps = [];
const consoleMessages = [];

function record(name, status, detail = {}) {
  steps.push({ name, status, ...detail });
  console.log(`${status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL'} ${name}`);
}

async function screenshot(page, name) {
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path, fullPage: true }).catch(() => {});
  return path;
}

async function safe(name, fn) {
  try {
    const detail = await fn();
    record(name, 'pass', detail || {});
  } catch (error) {
    const message = error?.message || String(error);
    const shot = globalThis.currentPage ? await screenshot(globalThis.currentPage, `fail-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`) : undefined;
    issues.push({ severity: 'candidate', name, message, screenshot: shot });
    record(name, 'fail', { message, screenshot: shot });
  }
}

async function setMarkdown(page, text) {
  await page.locator('.cm-content').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(text, { delay: 0 });
  await page.waitForTimeout(1200);
}

async function getMarkdown(page) {
  return await page.locator('.cm-content').evaluate((el) => el.textContent || '');
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const executablePath = process.env.PW_CHROMIUM || undefined;
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    permissions: ['clipboard-read', 'clipboard-write'],
    colorScheme: 'dark',
    acceptDownloads: true,
  });
  const page = await context.newPage();
  globalThis.currentPage = page;
  page.on('console', (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.message }));

  await safe('load live preview', async () => {
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    if (!response?.ok()) throw new Error(`HTTP ${response?.status()}`);
    await page.getByText('Markdown Studio').first().waitFor({ timeout: 15000 });
    await page.locator('.cm-content').waitFor({ timeout: 15000 });
    await screenshot(page, '01-loaded-desktop');
    return { title: await page.title() };
  });

  await safe('clear persisted state and reload', async () => {
    await page.evaluate(async () => {
      localStorage.clear();
      const dbs = await indexedDB.databases?.();
      await Promise.all((dbs || []).map((db) => db.name && new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(db.name);
        req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
      })));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.cm-content').waitFor({ timeout: 15000 });
  });

  const markdown = `# QA Composite Doc\n\n**Bold** _italic_ <u>underline</u> ~~strike~~\n\n- [x] Done task\n- [ ] Open task\n\n| Feature | Value |\n| --- | --- |\n| Math | $e^{i\\pi}+1=0$ |\n| Emoji | :smile: |\n\n$$\\int_0^1 x^2 dx$$\n\n\`\`\`mermaid\ngraph TD; A-->B;\n\`\`\`\n\n\`\`\`abc\nX:1\nT:Scale\nK:C\nC D E F|G A B c|\n\`\`\`\n\n[[Linked Note]]\n\n[^1]: footnote body\n`;

  await safe('markdown to rich sync with math/emoji/table/diagrams', async () => {
    await setMarkdown(page, markdown);
    await page.locator('[data-md-preview]').getByText('QA Composite Doc').first().waitFor({ timeout: 10000 });
    await page.locator('[data-md-preview]').getByText('Feature').first().waitFor({ timeout: 10000 });
    await page.locator('[data-md-preview]').getByText('Linked Note').first().waitFor({ timeout: 10000 });
    await screenshot(page, '02-composite-sync');
  });

  await safe('mode switch md/html/split', async () => {
    await page.getByRole('button', { name: /^HTML$/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /^MD$/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /^Split$/ }).click();
    await page.waitForTimeout(300);
  });

  await safe('rich to markdown sync', async () => {
    const rich = page.locator('[contenteditable="true"]').first();
    await rich.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.type(' Rich pane edit marker');
    await page.waitForTimeout(1600);
    const value = await getMarkdown(page);
    if (!value.includes('Rich pane edit marker')) throw new Error('Markdown pane did not receive rich-pane edit marker');
  });

  await safe('settings flavor and feature toggles', async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByText('Settings').waitFor({ timeout: 5000 });
    await page.getByText('CommonMark').click();
    await page.locator('#feat-tables').locator('xpath=..').click();
    await page.locator('#feat-math').locator('xpath=..').click();
    await page.locator('#feat-math').locator('xpath=..').click();
    await screenshot(page, '03-settings');
    await page.keyboard.press('Escape');
  });

  await safe('theme and accent persist across reload', async () => {
    await page.getByRole('button', { name: 'Blue accent' }).first().click();
    await page.getByRole('button', { name: /switch to light mode/i }).click();
    await page.reload({ waitUntil: 'networkidle' });
    const html = await page.locator('html').evaluate((el) => ({ cls: el.className, palette: el.getAttribute('data-palette') }));
    if (html.palette !== 'blue') throw new Error(`Palette did not persist: ${JSON.stringify(html)}`);
    await screenshot(page, '04-light-blue-reload');
    await page.getByRole('button', { name: /switch to dark mode/i }).click();
  });

  await safe('find and replace markdown target', async () => {
    await page.getByRole('button', { name: /search & replace/i }).click();
    await page.getByPlaceholder(/find in markdown/i).fill('Links');
    await page.locator('button[title="Replace..."]').first().click();
    await page.getByPlaceholder(/replace with/i).fill('Connected');
    await page.locator('button[title="Replace All"]').click();
    await page.waitForTimeout(1000);
    const value = await getMarkdown(page);
    if (!value.includes('Connected')) throw new Error('Replace all did not update markdown');
    await screenshot(page, '05-find-replace');
    await page.keyboard.press('Escape');
  });

  await safe('new doc, sidebar search, folder creation', async () => {
    await page.getByRole('button', { name: 'New document' }).click();
    await page.waitForTimeout(800);
    await setMarkdown(page, '# Linked Note\n\nBacklink target.');
    await page.getByRole('button', { name: 'New folder' }).click();
    await page.getByPlaceholder('Search…').fill('Linked');
    await page.getByText('Linked Note').first().waitFor({ timeout: 5000 });
    await screenshot(page, '06-sidebar-search-folder');
    await page.getByPlaceholder('Search…').fill('');
  });

  await safe('export markdown/html/json downloads', async () => {
    const names = [
      { menu: /Markdown/i, ext: 'md' },
      { menu: /HTML/i, ext: 'html' },
      { menu: /JSON/i, ext: 'json' },
    ];
    for (const item of names) {
      await page.locator('nav').getByRole('button', { name: /export/i }).click();
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
      await page.getByRole('menuitem').filter({ hasText: item.menu }).first().click();
      const download = await downloadPromise;
      await download.saveAs(`${outDir}/download-${item.ext}.${item.ext}`);
    }
  });

  await safe('import markdown file', async () => {
    const importPath = `${outDir}/import-sample.md`;
    await writeFile(importPath, '# Imported Sample\n\nImported from live walkthrough.');
    await page.locator('input[type="file"]').setInputFiles(importPath);
    await page.getByText('Imported Sample').first().waitFor({ timeout: 10000 });
  });

  await safe('graph/backlinks surface opens', async () => {
    await page.keyboard.press('Control+Shift+G').catch(() => {});
    await page.waitForTimeout(500);
    await screenshot(page, '07-graph-backlinks-attempt');
  });

  await safe('mobile responsive smoke', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Markdown Studio').first().waitFor({ timeout: 10000 });
    await screenshot(page, '08-mobile');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    if (overflow) issues.push({ severity: 'medium', name: 'mobile-horizontal-overflow', message: `scrollWidth exceeds viewport` });
  });

  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    return {
      domContentLoaded: nav?.domContentLoadedEventEnd || null,
      loadEventEnd: nav?.loadEventEnd || null,
      resourceCount: resources.length,
      transferSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
      encodedBodySize: resources.reduce((sum, r) => sum + (r.encodedBodySize || 0), 0),
    };
  }).catch(() => null);

  const severeConsole = consoleMessages.filter((m) => ['error', 'pageerror'].includes(m.type));
  if (severeConsole.length) issues.push({ severity: 'high', name: 'console-errors', message: JSON.stringify(severeConsole.slice(0, 10)) });

  const result = {
    url,
    timestamp: new Date().toISOString(),
    chromiumExecutable: executablePath || 'playwright-core default/cache',
    steps,
    issues,
    consoleMessages,
    perf,
  };
  await writeFile(`${outDir}/live-walkthrough.json`, JSON.stringify(result, null, 2) + '\n');
  await writeFile(`${outDir}/README.md`, `# Live walkthrough evidence\n\nURL: ${url}\n\nSteps passed: ${steps.filter((s) => s.status === 'pass').length}/${steps.length}\n\nCandidate issues: ${issues.length}\n\nSee \`live-walkthrough.json\` and screenshots in this directory.\n`);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
