# Hacker News /newest Sort Validation

A Playwright automation script that validates the [Hacker News "newest" page](https://news.ycombinator.com/newest) correctly displays exactly 100 articles sorted from newest to oldest — validated across Chromium, Firefox, and WebKit in parallel.

## What it does

The script:
1. Navigates to Hacker News's `/newest` page
2. Paginates through "More" links to collect exactly 100 articles
3. Runs 5 independent validation checks against the collected data
4. Repeats the entire process across three browser engines simultaneously
5. Captures a screenshot automatically if any check fails or an error occurs
6. Generates a clean, readable HTML report of the results, including any screenshots

## Validation checks

Rather than validating sort order alone, this script checks:

- **Exactly 100 articles collected** — confirms pagination stopped at the right point
- **No duplicate article IDs** — catches accidental re-scraping of the same articles across page loads
- **All articles have a non-empty title** — catches broken or missing content, not just wrong order
- **All articles have a valid link** — structural validation beyond sort order
- **Articles sorted from newest to oldest** — the core requirement

## Why article IDs instead of timestamps

Hacker News displays relative timestamps ("3 minutes ago"), which aren't precise enough to reliably validate ordering between closely-posted articles. Instead, this script extracts each article's numeric ID from its HTML — HN IDs are assigned sequentially, so a higher ID always means a newer post. Comparing IDs directly is a more reliable sort-order check than parsing relative time text.

## Cross-browser, in parallel

The full validation suite runs independently across Chromium, Firefox, and WebKit using `Promise.all`, so all three run concurrently rather than sequentially — reducing total runtime to roughly the slowest single browser rather than the sum of all three.

## Handling flakiness

While testing, I encountered intermittent timeouts when clicking through pagination. After investigating, I found the pattern was consistent with Hacker News's own rate-limiting of rapid automated requests. Rather than relying on retries alone, I added:

- A deliberate pause before each pagination click, to reduce request frequency
- Retry logic (up to 3 attempts) for any pagination step that still fails
- Clear, specific error messages if a failure is unrecoverable, instead of a raw crash

Separately, during testing I also encountered a real Hacker News outage (confirmed via their public status history), which the script handled gracefully — reporting a clear per-browser error rather than hanging or crashing. This confirmed the error handling works correctly under real, unplanned failure conditions, not just simulated ones.

## Screenshots on failure

If any check fails, or an unrecoverable error occurs, the script automatically captures a screenshot of the page at that moment and saves it to a local `screenshots/` folder. The screenshot is also embedded directly in the HTML report next to the relevant browser's results.

This is most useful when the browser successfully loaded something unexpected (e.g., a rate-limit page or a layout change) — the screenshot shows exactly what the page looked like, which a text error alone wouldn't capture. It's less useful for a pure network timeout before any content loads, since there's nothing rendered yet to capture in that case.

## Running the script

```bash
npm install
npx playwright install
node index.js
```

The script will print progress and results to the console, then automatically open `report.html` in your default browser once complete.

## Tech stack

- **Playwright** (JavaScript) — browser automation across Chromium, Firefox, and WebKit
- **Node.js built-ins** (`fs`, `child_process`) — no unnecessary dependencies beyond Playwright itself

## Possible future improvements

- Adaptive pacing (only slow down pagination if a timeout is actually detected, rather than always pausing)
- JSON export of results alongside the HTML report, for machine-readable consumption