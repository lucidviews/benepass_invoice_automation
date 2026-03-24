# Downloader Patterns

Reference for `SKILL.md`. Use this to generate the right downloader for a given platform.

---

## Strategy A — Playwright (default)

Works for most sites. Use this first unless the site actively blocks headless browsers.

```js
const { chromium } = require('playwright');
const fs = require('fs');

async function downloadMyPlatformInvoice(savePath) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  try {
    await page.goto('https://example.com/login', { waitUntil: 'load' });
    // dismiss cookie banner
    try { await page.locator('#cookie-accept').click({ timeout: 5000 }); } catch {}
    // log in
    await page.locator('#email').fill(process.env.PLATFORM_EMAIL);
    await page.locator('#password').fill(process.env.PLATFORM_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(2000);
    // navigate to invoices
    await page.goto('https://example.com/invoices', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    // download
    const downloadPromise = page.waitForEvent('download');
    await page.locator('a[aria-label="Invoice"]').first().click();
    const download = await downloadPromise;
    await download.saveAs(savePath);
    console.log(`[MyPlatform] Invoice saved to ${savePath}`);
  } finally {
    await browser.close();
  }
}
module.exports = { downloadMyPlatformInvoice };
```

### Filtering to a specific row

When there are multiple invoices (e.g. one membership, one penalty fee), identify the right one by its row description:

```js
await page.locator('a[aria-label="Invoice"]').first().waitFor({ timeout: 30000 });
const allLinks = await page.locator('a[aria-label="Invoice"]').all();
let invoiceHref = null;
for (const link of allLinks) {
  // Try ancestor::*[2] first; adjust the number if it includes too much or too little text
  const rowText = await link.locator('xpath=ancestor::*[2]').innerText().catch(() => '');
  if (rowText.includes('Membership')) {
    invoiceHref = await link.getAttribute('href');
    break;
  }
}
if (!invoiceHref) throw new Error('Invoice not found — check the filter keyword');

// Navigate to URL directly (more reliable than clicking stale element)
const downloadPromise = page.waitForEvent('download');
page.goto(new URL(invoiceHref, 'https://example.com').href).catch(() => {}); // throws "Download is starting" — expected
const download = await downloadPromise;
await download.saveAs(savePath);
```

### API response interception

Some sites don't trigger a browser download — they call an internal API that returns the PDF. Intercept it:

```js
const pdfPromise = new Promise((resolve, reject) => {
  page.on('response', async (response) => {
    if (response.url().includes('invoiceDocument') && response.status() === 200) {
      const body = await response.body();
      try {
        // Some APIs wrap the PDF in JSON: { mime: "application/pdf", data: "<base64>" }
        const json = JSON.parse(body.toString());
        if (json.data) return resolve(Buffer.from(json.data, 'base64'));
      } catch {}
      // Otherwise it's raw PDF bytes
      if (body.slice(0, 4).toString() === '%PDF') resolve(body);
    }
  });
  setTimeout(() => reject(new Error('Timed out waiting for invoice response')), 30000);
});
await page.locator('button:has-text("Download")').first().click();
const pdfBuffer = await pdfPromise;
fs.writeFileSync(savePath, pdfBuffer);
```

---

## Strategy B — User's real browser (Cloudflare-protected sites)

When Playwright is blocked by Cloudflare or similar, use the user's real browser which has valid cookies and a trusted fingerprint.

### macOS + Arc browser (AppleScript)

```js
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');

async function downloadMyPlatformInvoice(savePath) {
  const existingFiles = new Set(fs.readdirSync(DOWNLOADS_DIR));

  // Open the URL in Arc (OS-level open — more reliable than AppleScript navigation)
  execSync('open -a "Arc" "https://example.com/invoices"');
  notify('Invoice Automation', 'Switch to the MyPlatform tab in Arc to download the invoice');
  console.log('[MyPlatform] Waiting for tab to become active — please switch to it in Arc...');

  await sleep(8000); // give Arc time to load the page

  const scriptPath = path.join(os.tmpdir(), 'myplatform_click.applescript');
  fs.writeFileSync(scriptPath,
`tell application "Arc"
  repeat 30 times
    try
      with timeout of 4 seconds
        tell front window
          tell active tab
            set tabName to name
            -- use tab title (reliable) to detect page; do NOT use execute javascript for detection
            if tabName contains "Invoices" then
              -- use "contains" not "starts with" or "is" — Arc wraps JS return values in quotes
              set info to execute javascript "(function(){ var b=document.querySelectorAll('[data-qa=\\"invoice-download-pdf\\"]'); if(b.length>0){ b[0].click(); return 'clicked:'+b.length; } return 'loading'; })()"
              if info is not missing value and info contains "clicked" then
                return info
              end if
            end if
          end tell
        end tell
      end timeout
    end try
    delay 2
  end repeat
  return "timeout"
end tell
`);

  const result = spawnSync('osascript', [scriptPath], { encoding: 'utf8', timeout: 180000 });
  const clickResult = (result.stdout || '').trim().replace(/^"|"$/g, '');
  console.log('[MyPlatform] Click result:', clickResult);
  if (!clickResult.contains('clicked')) {
    throw new Error(`[MyPlatform] Download button not found. Result: ${clickResult || result.stderr}`);
  }

  // Watch ~/Downloads for the new PDF
  const start = Date.now();
  while (Date.now() - start < 3 * 60 * 1000) {
    const current = fs.readdirSync(DOWNLOADS_DIR);
    const newPdfs = current.filter(f =>
      !existingFiles.has(f) && f.toLowerCase().endsWith('.pdf') && !f.endsWith('.crdownload')
    );
    if (newPdfs.length > 0) {
      const newest = newPdfs
        .map(f => ({ name: f, mtime: fs.statSync(path.join(DOWNLOADS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0].name;
      fs.copyFileSync(path.join(DOWNLOADS_DIR, newest), savePath);
      console.log(`[MyPlatform] Invoice saved to ${savePath}`);
      return;
    }
    await sleep(1000);
  }
  throw new Error('[MyPlatform] Timed out waiting for invoice download.');
}

function notify(title, message) {
  try { execSync(`osascript -e 'display notification "${message}" with title "${title}" sound name "Glass"'`); }
  catch { console.log(`\n*** ${title}: ${message} ***\n`); }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
module.exports = { downloadMyPlatformInvoice };
```

**Critical Arc/AppleScript rules:**
- Always use `front window`, never `window 1` — Arc's window numbering doesn't match the visible window
- Use `name` (tab title) to detect the right page, not `execute javascript "location.href"` — the JS call returns `missing value` while loading
- Use `contains` for string comparisons — Arc wraps JS return values in extra quotes
- `open -a "Arc" "https://..."` is more reliable than AppleScript URL navigation

### macOS + Chrome (persistent profile)

```js
const context = await chromium.launchPersistentContext(
  '/Users/yourname/Library/Application Support/Google/Chrome/Default',
  { channel: 'chrome', headless: false }
);
// Chrome must be fully closed before running this
```

### Windows/Linux + Chrome (remote debugging)

Launch Chrome with: `chrome.exe --remote-debugging-port=9222`
Then connect:
```js
const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = await context.newPage();
```

---

## PDF Amount Parsing

`pdfParser.js` handles the extraction. It tries labeled patterns first, then falls back to the largest currency amount on the page.

**If the fallback picks up the wrong amount** (e.g. a subtotal instead of the total), add a labeled pattern to `pdfParser.js`:

```js
// In the labeledPatterns array:
[/(?:YourLabel)[:\s]*(?:EUR|€)\s*(\d{1,3}(?:,\d{3})*\.\d{2})/gi, parseEnglishAmount],
```

Available parse functions: `parseGermanAmount` (`1.234,56` format), `parseEnglishAmount` (`1,234.56` format).
