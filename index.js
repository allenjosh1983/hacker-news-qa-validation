const { chromium, firefox, webkit } = require('playwright');
const fs = require('fs');
const { exec } = require('child_process');

if (!fs.existsSync('screenshots')) {
  fs.mkdirSync('screenshots');
}

const PAGES_TO_TEST = [
  { path: '/newest', name: 'Newest', checkSort: true },
  { path: '/jobs', name: 'Jobs', checkSort: true },
];

const CONCURRENCY_LIMIT = 2;

async function clickMoreWithRetry(page, countBeforeClick, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const moreLink = page.locator('a.morelink');
      await moreLink.click();

      await page.waitForFunction(
        () => document.querySelectorAll('tr.athing').length > 0,
        countBeforeClick,
        { timeout: 15000 }
      );

      await page.waitForTimeout(500);
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        throw new Error(`Failed to load more articles after ${maxRetries} attempts. Last error: ${error.message}`);
      }
      await page.waitForTimeout(2000);
    }
  }
}

async function collectArticles(page, targetCount = 100) {
  await page.waitForSelector('tr.athing', { timeout: 15000 });

  const articles = [];

  while (articles.length < targetCount) {

     const rows = await page.locator('tr.athing').all();

    for (const row of rows) {
      const id = await row.getAttribute('id');
      if (articles.some((a) => a.id === id)) continue;

      const titleLink = row.locator('.titleline a').first();
      const title = await titleLink.innerText().catch(() => '');
      const href = await titleLink.getAttribute('href').catch(() => '');

      articles.push({ id, title, href });
    }

    if (articles.length < targetCount) {
      const moreLink = page.locator('a.morelink');
      const moreLinkExists = (await moreLink.count()) > 0;
      if (!moreLinkExists) {
        break;
      }
      const countBeforeClick = articles.length;
      await page.waitForTimeout(3000);
      await clickMoreWithRetry(page, countBeforeClick);
    }
  }

  return articles.slice(0, targetCount);
}

function runChecks(articles, checkSort) {
  const checks = [];

  checks.push({
    name: 'At least 1 article collected',
    passed: articles.length > 0,
    details: `Collected ${articles.length} articles.`,
  });

  const idSet = new Set(articles.map((a) => a.id));
  checks.push({
    name: 'No duplicate article IDs',
    passed: idSet.size === articles.length,
    details:
      idSet.size === articles.length
        ? `All ${articles.length} IDs are unique.`
        : `Found ${articles.length - idSet.size} duplicate ID(s).`,
  });

  const missingTitles = articles.filter((a) => !a.title || a.title.trim() === '');
  checks.push({
    name: 'All articles have a non-empty title',
    passed: missingTitles.length === 0,
    details:
      missingTitles.length === 0
        ? 'Every article has a title.'
        : `${missingTitles.length} article(s) had a missing/empty title (e.g. ID ${missingTitles[0]?.id}).`,
  });

  const missingLinks = articles.filter((a) => !a.href || a.href.trim() === '');
  checks.push({
    name: 'All articles have a valid link',
    passed: missingLinks.length === 0,
    details:
      missingLinks.length === 0
        ? 'Every article has a link.'
        : `${missingLinks.length} article(s) had a missing link (e.g. ID ${missingLinks[0]?.id}).`,
  });

  if (checkSort && articles.length > 1) {
    let sortPassed = true;
    let sortFailureDetails = null;
    for (let i = 0; i < articles.length - 1; i++) {
      const current = parseInt(articles[i].id);
      const next = parseInt(articles[i + 1].id);
      if (current <= next) {
        sortPassed = false;
        sortFailureDetails = { position: i, currentId: current, nextId: next };
        break;
      }
    }
    checks.push({
      name: 'Articles sorted from newest to oldest',
      passed: sortPassed,
      details: sortPassed
        ? `IDs strictly decrease across all ${articles.length} articles.`
        : `Order broken at position ${sortFailureDetails.position}: ID ${sortFailureDetails.currentId} is not newer than ID ${sortFailureDetails.nextId}.`,
    });
  }

  return checks;
}

async function tryCaptureScreenshot(page, label) {
  try {
    const filename = `screenshots/failure-${label}.png`;
    await page.screenshot({ path: filename, fullPage: true, timeout: 5000 });
    return filename;
  } catch (screenshotError) {
    return null;
  }
}

async function runForPageAndBrowser(browserType, browserName, pageConfig) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const result = {
    browserName,
    pageName: pageConfig.name,
    checks: [],
    error: null,
    screenshotPath: null,
  };

  const label = `${pageConfig.name.replace(/\s+/g, '-')}-${browserName}`;

  try {
    await page.goto(`https://news.ycombinator.com${pageConfig.path}`, { timeout: 15000 });
    const articles = await collectArticles(page);
    result.checks = runChecks(articles, pageConfig.checkSort);

    const anyCheckFailed = result.checks.some((c) => !c.passed);
    if (anyCheckFailed) {
      result.screenshotPath = await tryCaptureScreenshot(page, `${label}-check-failure`);
    }
  } catch (error) {
    result.error = error.message;
    result.screenshotPath = await tryCaptureScreenshot(page, `${label}-error`);
  } finally {
    await browser.close();
  }

  return result;
}

async function runWithConcurrencyLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  const workerCount = Math.min(limit, items.length);
  const runners = Array.from({ length: workerCount }, () => runNext());
  await Promise.all(runners);

  return results;
}

function generateHtmlReport(allResults) {
  const timestamp = new Date().toLocaleString();

  const pageGroups = {};
  for (const result of allResults) {
    if (!pageGroups[result.pageName]) pageGroups[result.pageName] = [];
    pageGroups[result.pageName].push(result);
  }

  const pageSections = Object.entries(pageGroups)
    .map(([pageName, results]) => {
      const browserBlocks = results
        .map((result) => {
          const screenshotHtml = result.screenshotPath
            ? `<div class="screenshot-box"><strong>Screenshot:</strong><br><img src="${result.screenshotPath}" style="max-width:100%; border:1px solid #ccc; margin-top:8px;"></div>`
            : '';

          if (result.error) {
            return `
            <div class="browser-block">
              <h3>${result.browserName}</h3>
              <div class="error-box"><strong>Error:</strong> ${result.error}</div>
              ${screenshotHtml}
            </div>`;
          }

          const rows = result.checks
            .map(
              (c) => `
            <tr class="${c.passed ? 'pass-row' : 'fail-row'}">
              <td>${c.passed ? '✅' : '❌'}</td>
              <td>${c.name}</td>
              <td>${c.details}</td>
            </tr>`
            )
            .join('\n');

          const allPassed = result.checks.every((c) => c.passed);

          return `
          <div class="browser-block">
            <h3>${result.browserName} — <span style="color:${allPassed ? '#2e7d32' : '#c62828'}">${allPassed ? 'PASS' : 'FAIL'}</span></h3>
            <table>
              <tr><th></th><th>Check</th><th>Details</th></tr>
              ${rows}
            </table>
            ${screenshotHtml}
          </div>`;
        })
        .join('\n');

      return `
      <div class="page-block">
        <h2>${pageName}</h2>
        ${browserBlocks}
      </div>`;
    })
    .join('\n');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Hacker News Validation Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #222; }
    h1 { margin-bottom: 4px; }
    h2 { border-bottom: 2px solid #1F3864; padding-bottom: 6px; margin-top: 40px; }
    .meta { color: #555; margin-bottom: 30px; }
    .page-block { margin-bottom: 20px; }
    .browser-block { margin: 18px 0 18px 12px; }
    table { border-collapse: collapse; width: 100%; max-width: 800px; }
    td, th { padding: 8px 12px; border-bottom: 1px solid #eee; text-align: left; }
    .pass-row { background: #f1f8f2; }
    .fail-row { background: #fdecea; }
    .error-box { background: #fdecea; border: 1px solid #c62828; padding: 12px; border-radius: 6px; }
    .screenshot-box { margin-top: 12px; max-width: 800px; }
  </style>
</head>
<body>
  <h1>Hacker News Validation Report</h1>
  <p class="meta">Run at: ${timestamp} | Pages tested: ${PAGES_TO_TEST.length} | Browsers: Chromium, Firefox, WebKit</p>
  ${pageSections}
</body>
</html>
`;

  fs.writeFileSync('report.html', html);
  console.log('\nHTML report generated: report.html');

  const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${opener} report.html`);
}

(async () => {
  const startTime = Date.now();
  const browsers = [
    { type: chromium, name: 'Chromium' },
    { type: firefox, name: 'Firefox' },
    { type: webkit, name: 'WebKit' },
  ];

  const tasks = [];
  for (const pageConfig of PAGES_TO_TEST) {
    for (const { type, name } of browsers) {
      tasks.push({ pageConfig, browserType: type, browserName: name });
    }
  }

  console.log(`Running validation across ${PAGES_TO_TEST.length} pages x 3 browsers (${tasks.length} total runs, max ${CONCURRENCY_LIMIT} at a time)...\n`);

  const allResults = await runWithConcurrencyLimit(tasks, CONCURRENCY_LIMIT, async ({ pageConfig, browserType, browserName }) => {
    const result = await runForPageAndBrowser(browserType, browserName, pageConfig);

    if (result.error) {
      console.log(`ERROR [${pageConfig.name}] [${browserName}]: ${result.error}`);
    } else {
      for (const check of result.checks) {
        console.log(`${check.passed ? 'PASS' : 'FAIL'} [${pageConfig.name}] [${browserName}] ${check.name} - ${check.details}`);
      }
    }

    return result;
  });

  generateHtmlReport(allResults);
  const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nTotal run time: ${durationSeconds} seconds`);
})();