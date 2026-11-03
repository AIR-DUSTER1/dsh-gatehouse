import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const chromePath = process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const email = process.env.BROWSER_TEST_EMAIL;
const password = process.env.BROWSER_TEST_PASSWORD;
if (!email || !password) throw new Error('Set BROWSER_TEST_EMAIL and BROWSER_TEST_PASSWORD for the browser smoke test.');

mkdirSync('.run/screens', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const requestFailures = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
page.on('pageerror', error => pageErrors.push(error.message));
page.on('requestfailed', request => requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText}`));

function assert(condition, message) { if (!condition) throw new Error(message); }

try {
  await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '登录控制台' }).waitFor();
  await page.getByLabel('工作邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入控制台' }).click();
  await page.waitForURL('http://127.0.0.1:5173/', { timeout: 15000 });
  await page.getByRole('heading', { name: /早上好|下午好|晚上好/ }).waitFor();
  await page.screenshot({ path: '.run/screens/01-dashboard.png', fullPage: true });

  for (const [path, heading] of [['/review', '复核中心'], ['/schedule', '执行调度'], ['/executions', '交付记录'], ['/audit', '审计日志'], ['/settings', '系统设置']]) {
    await page.goto(`http://127.0.0.1:5173${path}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: heading }).waitFor();
  }
  await page.screenshot({ path: '.run/screens/02-settings.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '打开导航' }).click();
  const drawer = page.locator('.ant-drawer-content-wrapper');
  await drawer.waitFor({ state: 'visible' });
  assert(await drawer.isVisible(), '移动端侧边栏未打开');
  await page.screenshot({ path: '.run/screens/03-mobile-menu.png', fullPage: true });

  const result = { ok: true, consoleErrors, pageErrors, requestFailures,
    screenshots: ['01-dashboard.png', '02-settings.png', '03-mobile-menu.png'] };
  writeFileSync('.run/browser-smoke.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (consoleErrors.length || pageErrors.length || requestFailures.length) process.exitCode = 1;
} catch (error) {
  const result = { ok: false, error: error instanceof Error ? error.stack : String(error), consoleErrors, pageErrors, requestFailures };
  writeFileSync('.run/browser-smoke.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: '.run/screens/failure.png', fullPage: true }).catch(() => {});
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
