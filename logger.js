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
