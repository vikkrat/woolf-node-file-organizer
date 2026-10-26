// Optional documentation tool: npm install --no-save playwright, then run this file.
// Screenshots show unedited CLI stdout rendered in a browser, not a native terminal.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

/** Escape command output before inserting it into the HTML transcript viewer. */
function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Run the actual CLI against fixtures only, preserving raw logs and browser captures. */
async function capture() {
  const root = path.resolve(__dirname, '..');
  const screenshots = path.join(root, 'screenshots');
  await fs.mkdir(screenshots, { recursive: true });
  const commands = [
    ['01-scan', ['scan', 'test-data/input']],
    ['02-duplicates', ['duplicates', 'test-data/input']],
    ['03-organize', ['organize', 'test-data/input', '--output', 'test-data/organized']],
    ['04-cleanup-preview', ['cleanup', 'test-data/input', '--older-than', '90']],
    ['05-cleanup-confirm', ['cleanup', 'test-data/input', '--older-than', '90', '--confirm']],
  ];
  const browser = await chromium.launch({ headless: true, ...(process.env.CAPTURE_BROWSER_CHANNEL ? { channel: process.env.CAPTURE_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
    for (const [name, args] of commands) {
      const result = spawnSync(process.execPath, ['file-organizer.js', ...args], { cwd: root, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || 'CLI execution failed');
      const command = `node file-organizer.js ${args.join(' ')}`;
      const transcript = `$ ${command}\n${result.stdout}`;
      await fs.writeFile(path.join(screenshots, `${name}.txt`), transcript);
      await page.setContent(`<html><style>body{margin:0;background:#101725;color:#dde8f4;padding:36px;font:16px/1.55 Consolas,monospace}header{color:#73dcc5;border-bottom:1px solid #344258;padding-bottom:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#98aac0}</style><header>FILE ORGANIZER <small>/ actual CLI output</small></header><pre>${escapeHtml(transcript)}</pre><small>Browser-rendered execution transcript · exit code ${result.status}</small></html>`);
      await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true });
      console.log(`Captured ${name} (exit ${result.status})`);
    }
  } finally { await browser.close(); }
}

capture().catch(error => { console.error(error); process.exitCode = 1; });
