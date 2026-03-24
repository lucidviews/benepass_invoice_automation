require('dotenv').config();
const path = require('path');
const fs = require('fs');

const { submitBenepassReimbursements } = require('./benepass');
const { extractAmountFromPDF } = require('./pdfParser');

const INVOICES_DIR = path.join(process.env.HOME, 'Documents', 'invoices');

// ── Stipend caps ─────────────────────────────────────────────────────────────
// Adjust these to match your company's reimbursement policy.
// For a combined cap across two platforms (e.g. two phone/internet bills),
// the code will split proportionally so neither bill is arbitrarily penalised.
const CAPS = {
  // 'My Stipend Name': 99.25,
};

// ── Platforms ─────────────────────────────────────────────────────────────────
// Add an entry here for each invoice source you automate.
// Claude will generate the downloader file and add the entry for you.
//
// Example:
// const { downloadMyPlatformInvoice } = require('./downloaders/myplatform');
//
// const PLATFORMS = [
//   {
//     id: 'myplatform',
//     label: 'My Platform',
//     filename: 'myplatform.pdf',
//     download: downloadMyPlatformInvoice,
//     merchant: 'My Platform Inc.',
//     description: 'Monthly subscription',
//     category: 'Cell & Internet Stipend',  // must match Benepass dropdown exactly
//     cap: CAPS['Cell & Internet Stipend'],
//   },
// ];
const PLATFORMS = [];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const onlyArg = process.argv.find(a => a.startsWith('--only='));
  const only = onlyArg
    ? onlyArg.replace('--only=', '').split(',')
    : PLATFORMS.map(p => p.id);

  validateEnv();

  if (PLATFORMS.length === 0) {
    console.error('\nNo platforms configured. Open a Claude session and run the invoice-automation skill to get started.\n');
    process.exit(1);
  }

  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthDir = path.join(INVOICES_DIR, monthStr);
  fs.mkdirSync(monthDir, { recursive: true });

  const active = PLATFORMS.filter(p => only.includes(p.id));

  // ── Step 1: Download invoices ───────────────────────────────────────────────
  console.log(`\n=== Invoice Automation — ${monthStr} ===\n`);
  console.log('Step 1: Downloading invoices...\n');

  for (const platform of active) {
    platform.invoicePath = path.join(monthDir, platform.filename);
    await platform.download(platform.invoicePath);
  }

  // ── Step 2: Extract amounts ─────────────────────────────────────────────────
  console.log('\nStep 2: Extracting amounts from invoices...\n');

  for (const platform of active) {
    platform.amount = await extractAmountFromPDF(platform.invoicePath);
    console.log(`  ${platform.label}: ${formatAmount(platform.amount, platform.currency)}`);
  }

  // ── Step 3: Apply caps ──────────────────────────────────────────────────────
  console.log('\nStep 3: Applying stipend caps...\n');

  // Group platforms that share a combined cap
  const capGroups = {};
  for (const platform of active) {
    if (!platform.cap) { platform.reimbursement = platform.amount; continue; }
    const key = `${platform.category}__${platform.cap}`;
    if (!capGroups[key]) capGroups[key] = [];
    capGroups[key].push(platform);
  }

  for (const [key, group] of Object.entries(capGroups)) {
    const cap = group[0].cap;
    const total = group.reduce((s, p) => s + p.amount, 0);
    if (total > cap) {
      const ratio = cap / total;
      for (const platform of group) {
        platform.reimbursement = Math.round(platform.amount * ratio * 100) / 100;
      }
      // Fix rounding: ensure sum doesn't exceed cap
      const sum = group.reduce((s, p) => s + p.reimbursement, 0);
      if (sum > cap) group[group.length - 1].reimbursement = Math.round((cap - group.slice(0, -1).reduce((s, p) => s + p.reimbursement, 0)) * 100) / 100;
      const labels = group.map(p => `${p.label} ${formatAmount(p.reimbursement, p.currency)}`).join(', ');
      console.log(`  ${group[0].category} combined (${formatAmount(total, group[0].currency)}) exceeds cap (${formatAmount(cap, group[0].currency)}).`);
      console.log(`  Splitting proportionally → ${labels}`);
    } else {
      for (const platform of group) platform.reimbursement = platform.amount;
      console.log(`  ${group[0].category} combined: ${formatAmount(total, group[0].currency)} — within cap ✓`);
    }
  }

  for (const platform of active) {
    if (platform.reimbursement === undefined) {
      const capped = platform.cap ? Math.min(platform.amount, platform.cap) : platform.amount;
      platform.reimbursement = capped;
      if (platform.cap && platform.amount > platform.cap) {
        console.log(`  ${platform.label} (${formatAmount(platform.amount, platform.currency)}) exceeds cap — capping at ${formatAmount(capped, platform.currency)}`);
      } else if (platform.cap) {
        console.log(`  ${platform.label}: ${formatAmount(platform.amount, platform.currency)} — within cap ✓`);
      }
    }
  }

  // ── Step 4: Submit to Benepass ──────────────────────────────────────────────
  const expenses = active.map(p => ({
    amount: p.reimbursement,
    merchant: p.merchant,
    description: p.description,
    category: p.category,
    invoicePath: p.invoicePath,
  }));

  if (dryRun) {
    console.log('\nStep 4: Dry run — skipping Benepass submission.\n');
    console.log('  Would submit:');
    for (const e of expenses) {
      console.log(`    ${e.merchant} — ${formatAmount(e.amount, active.find(p => p.merchant === e.merchant)?.currency)} (${e.category})`);
    }
    console.log('\n=== Dry run complete. Run without --dry-run to submit. ===\n');
    return;
  }

  console.log('\nStep 4: Submitting reimbursements to Benepass...');
  console.log('  (A notification will appear when fingerprint authentication is required)\n');
  await submitBenepassReimbursements(expenses);
  console.log('\n=== All done! Reimbursements submitted successfully. ===\n');
}

function formatAmount(amount, currency = 'EUR') {
  const symbols = { EUR: '€', USD: '$', GBP: '£' };
  const symbol = symbols[currency] || currency + ' ';
  return `${symbol}${amount.toFixed(2)}`;
}

function validateEnv() {
  const required = ['BENEPASS_EMAIL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nAutomation failed:', err.message);
  process.exit(1);
});
