# benepass.js — Ready to Use

This file is already included in the repo. Do not modify it — it handles the full Okta SSO flow automatically.

## What it does

1. Launches a persistent Chromium browser (saves session to `~/.benepass-profile`)
2. Navigates to `app.getbenepass.com/expenses/create`
3. If not logged in: fills your email, clicks "Log In with dbt Labs SSO", clicks "Sign in with Okta FastPass", waits for you to touch your fingerprint
4. For each expense: selects the benefit category, fills amount/merchant/note, uploads the PDF receipt, submits

## First run

On first run you'll need to authenticate. A macOS notification will appear — touch your fingerprint in Okta Verify when prompted. The session is then saved and subsequent runs will skip authentication.

## Expense object shape

```js
{
  amount: 46.11,                        // number, after applying caps
  merchant: 'Acme Corp',               // shown as merchant in Benepass
  description: 'Monthly subscription', // shown as Note in Benepass
  category: 'Cell & Internet Stipend', // must exactly match Benepass dropdown text
  invoicePath: '/absolute/path.pdf',   // the downloaded invoice PDF
}
```

## Benefit categories

Must match the text in your Benepass dropdown exactly. Common ones:
- `Cell & Internet Stipend`
- `Health & Wellness Stipend`
- `Professional Development Stipend`

Check your own Benepass account for the full list.
