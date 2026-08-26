const { chromium, firefox, webkit } = require('playwright');
const fs = require('fs');
const { exec } = require('child_process');

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

async function collectArticles(page) {
  const articles = [];

  while (articles.length < 100) {
    const rows = await page.locator('tr.athing').all();

    for (const row of rows) {
      const id = await row.getAttribute('id');
      if (articles.some((a) => a.id === id)) continue;

      const titleLink = row.locator('.titleline a').first();
      const title = await titleLink.innerText().catch(() => '');
      const href = await titleLink.getAttribute('href').catch(() => '');

      articles.push({ id, title, href });
    }

    if (articles.length < 100) {
      const moreLink = page.locator('a.morelink');
      const moreLinkExists = (await moreLink.count()) > 0;
      if (!moreLinkExists) {
        throw new Error(`Only found ${articles.length} articles, but the "More" link is missing.`);
      }
      const countBeforeClick = articles.length;
      await page.waitForTimeout(3000);
      await clickMoreWithRetry(page, countBeforeClick);
    }
  }

  return articles.slice(0, 100);
}

function runChecks(articles) {
  const checks = [];

  checks.push({
    name: 'Exactly 100 articles collected',
    passed: articles.length === 100,
    details: `Collected ${articles.length} articles.`,
  });

  const idSet = new Set(articles.map((a) => a.id));
  checks.push({
    name: 'No duplicate article IDs',
    passed: idSet.size === articles.length,
    details:
      idSet.size === articles.length
        ? 'All 100 IDs are unique.'
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
      ? 'IDs strictly decrease across all 100 articles.'
      : `Order broken at position ${sortFailureDetails.position}: ID ${sortFailureDetails.currentId} is not newer than ID ${sortFailureDetails.nextId}.`,
  });

  return checks;
}

async function runForBrowser(browserType, browserName) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const result = { browserName, checks: [], error: null };

  try {
    await page.goto('https://news.ycombinator.com/newest', { timeout: 15000 });
    const articles = await collectArticles(page);
    result.checks = runChecks(articles);
  } catch (error) {
    result.error = error.message;
  } finally {
    await browser.close();
  }

  return result;
}

function generateHtmlReport(allResults) {
  const timestamp = new Date().toLocaleString();

  const browserSections = allResults
    .map((result) => {
      if (result.error) {
        return `
        <div class="browser-block">
          <h2>${result.browserName}</h2>
          <div class="error-box"><strong>Error:</strong> ${result.error}</div>
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
        <h2>${result.browserName} — <span style="color:${allPassed ? '#2e7d32' : '#c62828'}">${allPassed ? 'PASS' : 'FAIL'}</span></h2>
        <table>
          <tr><th></th><th>Check</th><th>Details</th></tr>
          ${rows}
        </table>
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
    .meta { color: #555; margin-bottom: 30px; }
    .browser-block { margin-bottom: 36px; }
    table { border-collapse: collapse; width: 100%; max-width: 800px; }
    td, th { padding: 8px 12px; border-bottom: 1px solid #eee; text-align: left; }
    .pass-row { background: #f1f8f2; }
    .fail-row { background: #fdecea; }
    .error-box { background: #fdecea; border: 1px solid #c62828; padding: 12px; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Hacker News /newest Validation Report</h1>
  <p class="meta">Run at: ${timestamp}</p>
  ${browserSections}
</body>
</html>
`;

  fs.writeFileSync('report.html', html);
  console.log('\nHTML report generated: report.html');

    const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${opener} report.html`);
}

(async () => {
  const browsers = [
    { type: chromium, name: 'Chromium' },
    { type: firefox, name: 'Firefox' },
    { type: webkit, name: 'WebKit' },
  ];

  console.log('Running validation across Chromium, Firefox, and WebKit in parallel...\n');

  const allResults = await Promise.all(
    browsers.map(async ({ type, name }) => {
      const result = await runForBrowser(type, name);

      if (result.error) {
        console.log(`⚠️ ${name} ERROR: ${result.error}`);
      } else {
        for (const check of result.checks) {
          console.log(`${check.passed ? '✅' : '❌'} [${name}] ${check.name} — ${check.details}`);
        }
      }

      return result;
    })
  );

  generateHtmlReport(allResults);
})();