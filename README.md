# Hacker News Sort Validation

A Playwright automation script that validates Hacker News listing pages correctly display articles sorted from newest to oldest — validated across Chromium, Firefox, and WebKit.

## What it does

The script:
1. Navigates to each configured Hacker News page (`/newest` and `/jobs`)
2. Paginates through "More" links to collect exactly 100 articles per page
3. Runs 5 independent validation checks against the collected data
4. Repeats the entire process across three browser engines, with a limited concurrency to avoid overloading the target site
5. Captures a screenshot automatically if any check fails or an error occurs
6. Generates a clean, readable HTML report of the results, grouped by page and browser, including any screenshots

## Validation checks

Rather than validating sort order alone, this script checks:

- **At least 1 article collected** — confirms the page actually returned content
- **No duplicate article IDs** — catches accidental re-scraping of the same articles across page loads
- **All articles have a non-empty title** — catches broken or missing content, not just wrong order
- **All articles have a valid link** — structural validation beyond sort order
- **Articles sorted from newest to oldest** — applied only to pages that are genuinely chronological (see below)

## Why article IDs instead of timestamps

Hacker News displays relative timestamps ("3 minutes ago"), which aren't precise enough to reliably validate ordering between closely-posted articles. Instead, this script extracts each article's numeric ID from its HTML — HN IDs are assigned sequentially, so a higher ID always means a newer post. Comparing IDs directly is a more reliable sort-order check than parsing relative time text.

## Expanding beyond a single page

The original scope only validated `/newest`. To get broader coverage, I looked at Hacker News's other main pages and found:

- **`/jobs`** is chronologically sorted the same way `/newest` is, so the same ID-descending sort check applies cleanly. This is included in the final test set.
- **The front page (`/`)** is ranked by a scoring algorithm (votes + time decay), not strict chronological order. Applying the ID-descending sort check there would produce a false failure, not a real bug — so while the other structural checks (duplicates, titles, links) would still apply, sort order does not.
- **`/ask` and `/show`** turned out to also be ranked pages, not chronological — Hacker News has separate `/asknew` and `/shownew` pages for the actual newest-first Ask HN and Show HN posts.

I initially built out a version covering five pages (`/newest`, `/jobs`, `/asknew`, `/shownew`, and the front page), but running all five across all three browsers simultaneously started triggering Hacker News's own rate-limiting more frequently, and significantly increased total runtime. I scaled the final version back to `/newest` and `/jobs`, which are directly comparable in sort behavior to the original assignment, and added a concurrency limit so only two browser sessions run against the site at once — this cut runtime substantially while keeping results reliable.

## Handling flakiness

While testing, I encountered intermittent timeouts when clicking through pagination. After investigating, I found the pattern was consistent with Hacker News's own rate-limiting of rapid automated requests. Rather than relying on retries alone, I added:

- A deliberate pause before each pagination click, to reduce request frequency
- Retry logic (up to 3 attempts) for any pagination step that still fails
- A concurrency limit capping how many browser sessions run against the site simultaneously
- Clear, specific error messages if a failure is unrecoverable, instead of a raw crash

Separately, during testing I also encountered a real Hacker News outage (confirmed via their public status history), which the script handled gracefully — reporting a clear per-page, per-browser error rather than hanging or crashing.

**Known intermittent issue:** even with the concurrency limit in place, the `Jobs` + `Chromium` combination occasionally times out waiting for the page to render, while every other page/browser combination consistently passes. I've ruled out this being a bug in the test logic itself (increasing wait timeouts did not resolve it, and the failure is isolated to this one specific combination), which points toward intermittent, environment-specific behavior rather than a flaw in the validation approach.

## Screenshots on failure

If any check fails, or an unrecoverable error occurs, the script automatically captures a screenshot of the page at that moment and saves it to a local `screenshots/` folder. The screenshot is also embedded directly in the HTML report next to the relevant result.

This has already proven useful in practice — one captured screenshot showed Hacker News's actual rate-limit page ("Sorry, we can't serve your requests this quickly") rendered in place of the expected listings, confirming the root cause of an error without needing to guess.

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
- Further investigation into the intermittent Jobs + Chromium timeout