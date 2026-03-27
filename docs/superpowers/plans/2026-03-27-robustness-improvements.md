# Invoice Automation — Robustness Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add run logging + macOS notifications, screenshot-on-failure debugging, stealth plugin for Cloudflare evasion, manual Cloudflare pause pattern, and Playwright MCP debugging guidance in the skill.

**Architecture:** A new `logger.js` module centralizes file logging and macOS notifications. `index.js` is updated to use it and removes its local `formatAmount` (moved to `logger.js`). `downloader-patterns.md` gains a stealth import in Strategy A, a screenshot-on-failure catch block, and a new Strategy C for Cloudflare manual pause. `SKILL.md` gets a Cloudflare question in Step 2 and Playwright MCP debugging guidance in Step 5.

**Tech Stack:** Node.js built-in `node:test` (no new dependencies), `playwright-extra` + `puppeteer-extra-plugin-stealth` (already in `package.json`), `osascript` (macOS notifications, already used in `benepass.js`)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `logger.js` | Timestamped file logging + macOS notifications + `formatAmount` |
| Create | `test/logger.test.js` | Unit tests for `logger.js` |
| Modify | `index.js` | Use `logger`, remove local `formatAmount`, call `notifyRunComplete` |
| Modify | `skills/invoice-automation/references/downloader-patterns.md` | Stealth import, screenshot-on-failure, Strategy C |
| Modify | `skills/invoice-automation/SKILL.md` | Cloudflare question in Step 2, Playwright MCP in Step 5 |

---

## Task 1: Create logger.js (TDD)

**Files:**
- Create: `test/logger.test.js`
- Create: `logger.js`

- [ ] **Step 1: Write the failing tests**

Create `test/logger.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Reset module cache between tests so each gets fresh logger state
function freshLogger() {
  delete require.cache[require.resolve('../logger')];
  return require('../logger');
}

test('log() writes timestamped line to log file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-test-'));
  const { initLog, log } = freshLogger();
  initLog(tmpDir);
  log('hello world');
  const content = fs.readFileSync(path.join(tmpDir, 'run.log'), 'utf8');
  assert.match(content, /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] hello world\n/);
  fs.rmSync(tmpDir, { recursive: true });
});

test('log() before initLog() does not throw', () => {
  const { log } = freshLogger();
  assert.doesNotThrow(() => log('no file yet'));
});

test('formatAmount() formats EUR correctly', () => {
  const { formatAmount } = freshLogger();
  assert.strictEqual(formatAmount(46.11, 'EUR'), '€46.11');
});

test('formatAmount() formats USD correctly', () => {
  const { formatAmount } = freshLogger();
  assert.strictEqual(formatAmount(29.00, 'USD'), '$29.00');
});

test('formatAmount() formats GBP correctly', () => {
  const { formatAmount } = freshLogger();
  assert.strictEqual(formatAmount(10.50, 'GBP'), '£10.50');
});

test('formatAmount() defaults to EUR when currency omitted', () => {
  const { formatAmount } = freshLogger();
  assert.strictEqual(formatAmount(5.99), '€5.99');
});

test('formatAmount() uses currency code as prefix for unknown currencies', () => {
  const { formatAmount } = freshLogger();
  assert.strictEqual(formatAmount(9.99, 'CHF'), 'CHF 9.99');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/logger.test.js
```

Expected: `Error: Cannot find module '../logger'`

- [ ] **Step 3: Implement logger.js**

Create `logger.js`:

```js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let logFile = null;

function initLog(monthDir) {
  logFile = path.join(monthDir, 'run.log');
}

function log(message) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${now}] ${message}`;
  console.log(message);
  if (logFile) {
    fs.appendFileSync(logFile, line + '\n');
  }
}

function notifyRunComplete(platforms, dryRun = false) {
  let message;
  if (dryRun) {
    const n = platforms.length;
    message = `Dry run complete — ${n} platform${n !== 1 ? 's' : ''} checked`;
  } else {
    const summary = platforms
      .map(p => `${p.merchant} ${formatAmount(p.reimbursement, p.currency)}`)
      .join(', ');
    message = `${platforms.length} submitted: ${summary}`;
  }
  log(message);
  notify('Invoice Automation', message);
}

function notifyError(errorMessage) {
  const message = `Automation failed: ${errorMessage}`;
  log(message);
  notify('Invoice Automation', message);
}

function formatAmount(amount, currency = 'EUR') {
  const symbols = { EUR: '€', USD: '$', GBP: '£' };
  const symbol = symbols[currency] || currency + ' ';
  return `${symbol}${amount.toFixed(2)}`;
}

function notify(title, message) {
  try {
    execSync(`osascript -e 'display notification "${message}" with title "${title}" sound name "Glass"'`);
  } catch {
    console.log(`\n*** ${title}: ${message} ***\n`);
  }
}

module.exports = { initLog, log, notifyRunComplete, notifyError, formatAmount };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/logger.test.js
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add logger.js test/logger.test.js
git commit -m "feat: add logger module with file logging and macOS notifications"
```

---

## Task 2: Wire logger into index.js

**Files:**
- Modify: `index.js`

- [ ] **Step 1: Update imports — add logger, import formatAmount from it**

Replace lines 1–6 of `index.js`:

```js
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const { submitBenepassReimbursements } = require('./benepass');
const { extractAmountFromPDF } = require('./pdfParser');
```

With:

```js
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const { submitBenepassReimbursements } = require('./benepass');
const { extractAmountFromPDF } = require('./pdfParser');
const logger = require('./logger');
const { formatAmount } = logger;
```

- [ ] **Step 2: Call logger.initLog after creating monthDir**

Find:

```js
  const monthDir = path.join(INVOICES_DIR, monthStr);
  fs.mkdirSync(monthDir, { recursive: true });
```

Add `logger.initLog(monthDir)` on the next line:

```js
  const monthDir = path.join(INVOICES_DIR, monthStr);
  fs.mkdirSync(monthDir, { recursive: true });
  logger.initLog(monthDir);
```

- [ ] **Step 3: Replace all console.log calls inside main() with logger.log**

Find and replace all `console.log(` occurrences inside `main()` with `logger.log(`. Do NOT change the `console.error` calls in `validateEnv()` — those run before the logger is initialized.

- [ ] **Step 4: Add notifyRunComplete to the dry-run return branch**

Find the dry-run exit block (after step 3 this will use logger.log):

```js
    logger.log('\n=== Dry run complete. Run without --dry-run to submit. ===\n');
    return;
```

Add `notifyRunComplete` before `return`:

```js
    logger.log('\n=== Dry run complete. Run without --dry-run to submit. ===\n');
    logger.notifyRunComplete(active, true);
    return;
```

- [ ] **Step 5: Add notifyRunComplete after the final success log**

Find:

```js
  logger.log('\n=== All done! Reimbursements submitted successfully. ===\n');
```

Add on the next line:

```js
  logger.log('\n=== All done! Reimbursements submitted successfully. ===\n');
  logger.notifyRunComplete(active);
```

- [ ] **Step 6: Replace the catch handler**

Find:

```js
main().catch(err => {
  console.error('\nAutomation failed:', err.message);
  process.exit(1);
});
```

Replace with:

```js
main().catch(err => {
  logger.notifyError(err.message);
  process.exit(1);
});
```

- [ ] **Step 7: Delete the local formatAmount function**

Find and delete these lines:

```js
function formatAmount(amount, currency = 'EUR') {
  const symbols = { EUR: '€', USD: '$', GBP: '£' };
  const symbol = symbols[currency] || currency + ' ';
  return `${symbol}${amount.toFixed(2)}`;
}
```

- [ ] **Step 8: Verify no syntax errors**

```bash
node -e "require('./index')" 2>&1 | head -3
```

Expected: the "No platforms configured" message (not a ReferenceError or SyntaxError).

- [ ] **Step 9: Commit**

```bash
git add index.js
git commit -m "feat: use logger in index.js, add run notifications and log file"
```

---

## Task 3: Update downloader-patterns.md — stealth import + screenshot on failure

**Files:**
- Modify: `skills/invoice-automation/references/downloader-patterns.md`

- [ ] **Step 1: Replace the Strategy A header and import**

Find:

```
## Strategy A — Playwright (default)

Works for most sites. Use this first unless the site actively blocks headless browsers.
```

Replace with:

```
## Strategy A — Playwright with stealth (default)

Works for most sites. The stealth plugin masks headless browser signals, preventing Cloudflare and similar systems from triggering a challenge before the login page even loads. Use this first.
```

Then find the import at the top of the Strategy A code block:

```js
const { chromium } = require('playwright');
const fs = require('fs');
```

Replace with:

```js
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

chromium.use(StealthPlugin());
```

- [ ] **Step 2: Add catch block with screenshot to Strategy A**

Find:

```js
    await download.saveAs(savePath);
    console.log(`[MyPlatform] Invoice saved to ${savePath}`);
  } finally {
    await browser.close();
  }
```

Replace with:

```js
    await download.saveAs(savePath);
    console.log(`[MyPlatform] Invoice saved to ${savePath}`);
  } catch (err) {
    const screenshotPath = '/tmp/myplatform-error.png';
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    throw new Error(`[MyPlatform] ${err.message} — screenshot saved to ${screenshotPath}`);
  } finally {
    await browser.close();
  }
```

- [ ] **Step 3: Add Playwright MCP debugging note after the Strategy A section**

After the closing backtick-block of Strategy A (before the `---` divider that leads into Strategy B), add:

```markdown
### Debugging with Playwright MCP

When a selector fails, Claude can inspect the live page:

1. The error message includes a screenshot path (e.g. `/tmp/myplatform-error.png`) — open it to see what the page looked like when it crashed.
2. Use `browser_navigate` to open the platform URL, `browser_snapshot` to get the DOM structure, and `browser_take_screenshot` to see the current state.
3. Identify the correct selector from the snapshot and update the downloader.

The SKILL.md Step 5 debugging flow uses these tools automatically.
```

- [ ] **Step 4: Commit**

```bash
git add skills/invoice-automation/references/downloader-patterns.md
git commit -m "feat: stealth import, screenshot-on-failure, and Playwright MCP note in downloader-patterns.md"
```

---

## Task 4: Update downloader-patterns.md — Strategy C (Cloudflare manual pause)

**Files:**
- Modify: `skills/invoice-automation/references/downloader-patterns.md`

- [ ] **Step 1: Add Strategy C section before PDF Amount Parsing**

Find the `---` divider immediately before `## PDF Amount Parsing` and insert the following before it:

```markdown
---

## Strategy C — Manual Cloudflare pause

Use when stealth (Strategy A) is not enough and Cloudflare shows a "Confirm you are human" challenge. The automation opens the browser, detects the challenge, notifies you to solve it manually, waits for Enter, then continues.

Add this detection block immediately after the first `page.goto` call in any Strategy A downloader:

```js
// After page.goto — detect and handle Cloudflare challenge
if (await isCloudflareChallenge(page)) {
  notify('Invoice Automation', 'Cloudflare challenge on MyPlatform — solve it in the browser, then press Enter');
  console.log('[MyPlatform] Solve the Cloudflare challenge in the browser window, then press Enter to continue...');
  await keypress();
}

// Helpers — add once per file, outside the main download function
async function isCloudflareChallenge(page) {
  if (page.url().includes('challenges.cloudflare.com')) return true;
  const count = await page.locator('iframe[src*="challenges.cloudflare.com"]').count();
  return count > 0;
}

function keypress() {
  return new Promise(resolve => process.stdin.once('data', resolve));
}
```

**When to escalate to Strategy B:** If the site challenges on every visit even after manual solving, switch to Strategy B (real browser with valid cookies).

**Strategy precedence:**

| Situation | Strategy |
|---|---|
| Normal site | A (stealth) |
| Cloudflare challenge on some visits | A (stealth) + C wrapper |
| Persistent blocking / fingerprint detection | B (real browser) |
```

- [ ] **Step 2: Commit**

```bash
git add skills/invoice-automation/references/downloader-patterns.md
git commit -m "feat: add Strategy C for Cloudflare manual pause to downloader-patterns.md"
```

---

## Task 5: Update SKILL.md — Cloudflare question + Playwright MCP debugging

**Files:**
- Modify: `skills/invoice-automation/SKILL.md`

- [ ] **Step 1: Expand the Cloudflare question in Step 2**

Find:

```
4. **Cloudflare / bot protection**: Does the site block automated browsers? If so, see the real-browser strategies in `references/downloader-patterns.md`.
```

Replace with:

```
4. **Cloudflare / bot protection**: Does the site show a "Confirm you are human" Cloudflare challenge when you visit it?
   - **No challenge**: Strategy A (stealth) handles this automatically.
   - **Occasional challenge**: use Strategy A + the Strategy C wrapper from `references/downloader-patterns.md`.
   - **Blocks completely even after manual solve**: use Strategy B (real browser).
```

- [ ] **Step 2: Replace the debugging guidance in Step 5**

Find:

```
If it fails, check:
- Is the selector still correct? Run with `headless: false` and add `await page.pause()` to inspect
- Is the PDF amount being parsed correctly? Check `pdfParser.js` — you may need to add a labeled pattern for this platform's invoice format
- Is the Benepass category name an exact match to what the dropdown shows?
```

Replace with:

```
If it fails, check the error message for a screenshot path (e.g. `/tmp/myplatform-error.png`) and open it to see what the page looked like when it crashed.

**Selector issues** — use the Playwright MCP to inspect the live page:
1. Use `browser_navigate` to open the platform's login or invoices URL
2. Use `browser_snapshot` to get the current DOM structure
3. Identify the correct selector from the snapshot
4. Update the downloader and re-run the dry run

**PDF parsing issues** — check `pdfParser.js`. You may need to add a labeled pattern for this platform's invoice format (see `references/downloader-patterns.md` → PDF Amount Parsing).

**Benepass category mismatch** — the category string must exactly match what the Benepass dropdown shows. Open the Benepass create expense page and verify the exact text.
```

- [ ] **Step 3: Commit**

```bash
git add skills/invoice-automation/SKILL.md
git commit -m "feat: update SKILL.md with Cloudflare guidance and Playwright MCP debugging flow"
```

---

## Self-Review

**Spec coverage:**
- ✅ `logger.js` with `initLog`, `log`, `notifyRunComplete`, `notifyError`, `formatAmount` — Task 1
- ✅ `index.js` uses logger, calls `notifyRunComplete` on dry run and real run, `notifyError` on catch — Task 2
- ✅ `formatAmount` moved from `index.js` to `logger.js` — Tasks 1 + 2
- ✅ Strategy A stealth import upgrade — Task 3
- ✅ Screenshot-on-failure catch block — Task 3
- ✅ Playwright MCP debugging note in downloader-patterns.md — Task 3
- ✅ Strategy C Cloudflare manual pause — Task 4
- ✅ `SKILL.md` Step 2 Cloudflare question with all three tiers — Task 5
- ✅ `SKILL.md` Step 5 Playwright MCP debugging flow — Task 5

**Placeholder scan:** None found.

**Type consistency:** `notifyRunComplete(platforms, dryRun)` receives the `active` array from `index.js`. By the time it is called, each platform has `.merchant` (from PLATFORMS config), `.reimbursement` (set in cap logic), and `.currency` (from PLATFORMS config, optional — `formatAmount` defaults to EUR). ✅
