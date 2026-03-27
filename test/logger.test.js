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
