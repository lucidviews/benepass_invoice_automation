---
name: invoice-automation
description: This skill should be used when the user wants to "set up invoice automation", "add a new invoice", "automate a reimbursement", "add a platform", "get started", or opens this repo for the first time. Guide the user interactively through configuring their personal invoice automation.
version: 1.0.0
---

# Invoice Automation Setup

You are helping the user configure automated invoice downloading and Benepass reimbursement submission. Work through this interactively — ask one topic at a time and generate code as you go.

## Step 1 — One-time Benepass setup

Before anything else, ask:

1. **Benepass email**: What email address do they use to log into Benepass?
2. **SSO button text**: When they go to the Benepass login page, what does the SSO button say? (e.g. "Acme Corp SSO", "Sign in with Google") — this is the button that redirects them to their company's identity provider.

Add both to `.env`:
```
BENEPASS_EMAIL=they@theircompany.com
BENEPASS_SSO_BUTTON_TEXT=Acme Corp SSO
```

Then ask:
- What invoices do they need to download each month? (list all platforms)
- For each platform: what is the website URL for the invoices page?

If they list multiple platforms, handle them one by one.

## Step 2 — For each platform, gather details

Ask these questions (skip any that are obvious from context):

1. **Login**: Does the site require a username/password? What are the field selectors, or should you inspect the page together?
2. **Invoice location**: Where on the site does the invoice appear — a list page, a download button, a PDF link? Is there a specific row or description to filter by (e.g. only membership invoices, not penalty fees)?
3. **Download mechanism**: Does clicking the button trigger a file download, open a PDF in a new tab, or call an API? (See `references/downloader-patterns.md` for how to identify and handle each case.)
4. **Cloudflare / bot protection**: Does the site show a "Confirm you are human" Cloudflare challenge when you visit it?
   - **No challenge**: Strategy A (stealth) handles this automatically.
   - **Occasional challenge**: use Strategy A + the Strategy C wrapper from `references/downloader-patterns.md`.
   - **Blocks completely even after manual solve**: use Strategy B (real browser).
5. **Amount format**: Is the invoice in EUR, USD, GBP, or another currency? German number format (`1.234,56`) or English (`1,234.56`)?
6. **Stipend category**: Which Benepass category does this fall under? (e.g. `Cell & Internet Stipend`, `Health & Wellness Stipend`, `Professional Development Stipend`) Check the user's Benepass account if unsure.
7. **Cap**: Is there a reimbursement cap for this category? If multiple platforms share one combined cap, note which ones.
8. **Merchant name**: What should appear as the merchant in Benepass?
9. **Note/description**: What should appear in the Note field (e.g. "Monthly phone bill")?

## Step 3 — Generate the downloader

Based on the answers, write `downloaders/<platform>.js` using the appropriate strategy from `references/downloader-patterns.md`. Use `headless: false` so the user can watch and debug.

Always:
- Accept `savePath` as the only argument
- Use `process.env.PLATFORM_EMAIL` / `process.env.PLATFORM_PASSWORD` for credentials (tell the user which env vars to add to `.env`)
- Add the env var names to `.env.example` with a comment
- Save the file with `fs.writeFileSync(savePath, buffer)` or `download.saveAs(savePath)`

## Step 4 — Wire it into index.js

Add the platform to `index.js`:
1. Add the import at the top
2. Add a `CAPS` entry if there's a cap
3. Add a `PLATFORMS` entry with all fields populated

For a **combined cap** across two platforms (e.g. two phone plans sharing one stipend): add both platforms with the same `category` and `cap` value — the proportional split logic handles it automatically.

## Step 5 — Test it

Run a dry run first:
```bash
node index.js --dry-run --only=<platform>
```

If it fails, check the error message for a screenshot path (e.g. `/tmp/myplatform-error.png`) and open it to see what the page looked like when it crashed.

**Selector issues** — use the Playwright MCP to inspect the live page:
1. Use `browser_navigate` to open the platform's login or invoices URL
2. Use `browser_snapshot` to get the current DOM structure
3. Identify the correct selector from the snapshot
4. Update the downloader and re-run the dry run

**PDF parsing issues** — check `pdfParser.js`. You may need to add a labeled pattern for this platform's invoice format (see `references/downloader-patterns.md` → PDF Amount Parsing).

**Benepass category mismatch** — the category string must exactly match what the Benepass dropdown shows. Open the Benepass create expense page and verify the exact text.

Once the dry run shows the right amounts, run for real:
```bash
node index.js --only=<platform>
```

## Step 6 — Repeat for remaining platforms

Go back to Step 2 for the next platform.

## Step 7 — First full run

Once all platforms are set up:
```bash
node index.js --dry-run   # verify everything looks right
node index.js             # submit all reimbursements to Benepass
```

On first run, Benepass will ask for Okta authentication — touch your fingerprint in Okta Verify when prompted. The session is saved in `~/.benepass-profile` so you won't need to do it every time.

---

## CLI Reference

```bash
node index.js --dry-run                           # all platforms, no submission
node index.js --dry-run --only=myplatform         # one platform, no submission
node index.js --dry-run --only=platform1,platform2
node index.js                                     # full run
node index.js --only=myplatform                   # submit one platform only
```
