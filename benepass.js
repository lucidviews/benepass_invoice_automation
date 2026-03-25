require('dotenv').config();
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');
const os = require('os');

const BENEPASS_URL = 'https://app.getbenepass.com/expenses/create';
const PROFILE_DIR = path.join(os.homedir(), '.benepass-profile');

async function submitBenepassReimbursements(expenses) {
  // Use a persistent context so Okta session survives between runs
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    acceptDownloads: false,
  });
  const page = await context.newPage();

  try {
    // Login
    await page.goto(BENEPASS_URL, { waitUntil: 'networkidle' });

    if (!page.url().includes('getbenepass.com')) {
      // Step 1: Benepass SSO page — fill email and click dbt Labs SSO
      if (!page.url().includes('okta.com')) {
        console.log('[Benepass] Entering email on Benepass SSO page...');
        await page.locator('input[name="email"], input[type="email"]').waitFor({ timeout: 15000 });
        await page.locator('input[name="email"], input[type="email"]').fill(process.env.BENEPASS_EMAIL);
        await page.locator('button', { hasText: new RegExp(process.env.BENEPASS_SSO_BUTTON_TEXT, 'i') }).click({ timeout: 10000 });
      }

      // Step 2: Okta page — click "Sign in with Okta FastPass"
      await page.waitForURL(/okta\.com/, { timeout: 30000 }).catch(() => {});
      if (page.url().includes('okta.com')) {
        console.log('[Benepass] On Okta — clicking Sign in with Okta FastPass...');
        notify('Invoice Automation', 'Touch fingerprint in Okta Verify to log into Benepass');
        await page.locator('a, button', { hasText: /Okta FastPass/i }).first().click({ timeout: 10000 }).catch(() => {
          console.log('[Benepass] FastPass button not found, trying email...');
        });
      }

      console.log('[Benepass] Waiting for authentication...');
      try {
        await page.waitForURL('https://app.getbenepass.com/**', { timeout: 120000 });
      } catch {
        console.log('[Benepass] Auth timeout. Current URL:', page.url());
        await page.screenshot({ path: '/tmp/benepass-stuck.png' });
        throw new Error('Benepass authentication timed out. Check /tmp/benepass-stuck.png');
      }
      await page.waitForLoadState('networkidle');
      console.log('[Benepass] Authenticated.');
    }

    for (const expense of expenses) {
      await submitExpense(page, expense);
    }
  } finally {
    await context.close();
  }

  console.log('\n[Benepass] All reimbursements submitted.');
}

async function submitExpense(page, expense) {
  console.log(`\n[Benepass] Submitting: ${expense.merchant} — €${expense.amount.toFixed(2)}`);

  await page.goto(BENEPASS_URL, { waitUntil: 'networkidle' });

  // Step 1: open the benefit dropdown and select the right stipend
  await page.locator('button', { hasText: 'Select benefit' }).waitFor({ timeout: 15000 });
  await page.locator('button', { hasText: 'Select benefit' }).click();

  // Wait for the stipend list and click the matching option
  await page.locator(`text=${expense.category}`).first().waitFor({ timeout: 10000 });
  await page.locator(`text=${expense.category}`).first().click();
  console.log(`[Benepass]  ✓ Selected benefit: ${expense.category}`);

  // Step 2: wait for details form
  await page.locator('input[name="amount"]').waitFor({ timeout: 15000 });

  // Amount
  await page.locator('input[name="amount"]').click({ clickCount: 3 });
  await page.locator('input[name="amount"]').fill(expense.amount.toFixed(2));
  console.log(`[Benepass]  ✓ Amount: ${expense.amount.toFixed(2)}`);

  // Merchant
  await page.locator('input[name="merchant"]').fill(expense.merchant);
  console.log(`[Benepass]  ✓ Merchant: ${expense.merchant}`);

  // Note
  await page.locator('input[name="note"]').fill(expense.description);
  console.log(`[Benepass]  ✓ Note: ${expense.description}`);

  // Upload receipt
  await page.locator('input#fileInput').setInputFiles(expense.invoicePath);
  console.log(`[Benepass]  ✓ Receipt uploaded`);

  await page.waitForTimeout(1500);

  // Submit
  await page.locator('button', { hasText: /submit/i }).click();
  console.log(`[Benepass]  ✓ Submitted`);

  // Wait for confirmation (navigation back or success indicator)
  await page.waitForTimeout(3000);
}

function notify(title, message) {
  try {
    execSync(`osascript -e 'display notification "${message}" with title "${title}" sound name "Glass"'`);
  } catch {
    console.log(`\n*** ${title}: ${message} ***\n`);
  }
}

module.exports = { submitBenepassReimbursements };
