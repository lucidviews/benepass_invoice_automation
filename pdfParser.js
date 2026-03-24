const pdfParse = require('pdf-parse');
const fs = require('fs');

// German format: "1.234,56" → 1234.56
function parseGermanAmount(str) {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

// English/international format: "1,234.56" → 1234.56
function parseEnglishAmount(str) {
  return parseFloat(str.replace(/,/g, ''));
}

async function extractAmountFromPDF(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(dataBuffer);
  const text = data.text;

  // Labeled patterns — most reliable, checked first.
  // Each entry: [regex, parseFn]
  // Add new entries here when onboarding a platform with a different label or format.
  const labeledPatterns = [
    // German labels, German number format (e.g. Vodafone DE, Freenet)
    [/(?:Gesamtbetrag|Rechnungsbetrag|Zahlbetrag|Endbetrag|zu\s+zahlen)[:\s]*(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:EUR|€)/gi, parseGermanAmount],
    // English labels, English number format (e.g. Urban Sports Club)
    [/(?:Total|Amount\s+due|Grand\s+total)[:\s]*(?:EUR|€)\s*(\d{1,3}(?:,\d{3})*\.\d{2})/gi, parseEnglishAmount],
    [/(?:Total|Amount\s+due)[:\s]*(\d{1,3}(?:,\d{3})*\.\d{2})\s*(?:EUR|€)/gi, parseEnglishAmount],
    // USD
    [/(?:Total|Amount\s+due|Grand\s+total)[:\s]*\$\s*(\d{1,3}(?:,\d{3})*\.\d{2})/gi, parseEnglishAmount],
    [/(?:Total|Amount\s+due)[:\s]*(\d{1,3}(?:,\d{3})*\.\d{2})\s*(?:USD|\$)/gi, parseEnglishAmount],
  ];

  for (const [pattern, parseFn] of labeledPatterns) {
    const match = pattern.exec(text);
    if (match) {
      const amount = parseFn(match[1]);
      if (amount > 0) return amount;
    }
  }

  // Fallback: collect all currency amounts and take the largest (usually the total)
  const allAmounts = [];
  let match;

  // German format: 1.234,56 EUR / €
  const germanPattern = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:EUR|€)/g;
  while ((match = germanPattern.exec(text)) !== null) {
    const amount = parseGermanAmount(match[1]);
    if (amount > 0) allAmounts.push(amount);
  }

  // English format: EUR/€ 1,234.56 or 1,234.56 EUR/€
  const englishPattern = /(?:EUR|€|\$|USD)\s*(\d{1,3}(?:,\d{3})*\.\d{2})|(\d{1,3}(?:,\d{3})*\.\d{2})\s*(?:EUR|€|\$|USD)/g;
  while ((match = englishPattern.exec(text)) !== null) {
    const raw = match[1] || match[2];
    const amount = parseEnglishAmount(raw);
    if (amount > 0) allAmounts.push(amount);
  }

  if (allAmounts.length > 0) {
    return Math.max(...allAmounts);
  }

  throw new Error(`Could not extract amount from PDF: ${pdfPath}`);
}

module.exports = { extractAmountFromPDF };
