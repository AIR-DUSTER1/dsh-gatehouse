import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const chromePath = process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const email = process.env.BROWSER_TEST_EMAIL;
const password = process.env.BROWSER_TEST_PASSWORD;
const expectedRepository = process.env.BROWSER_EXPECTED_REPOSITORY;
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
  await page.waitForURL(/http:\/\/127\.0\.0\.1:5173\/w\/[^/]+/, { timeout: 15000 });
  await page.getByRole('heading', { name: /早上好|下午好|晚上好/ }).waitFor();
  if (expectedRepository) {
    const meta = await page.locator('.workspace-card-meta').innerText();
    if (!meta.replace(/\s+/g, '').includes(expectedRepository.replace(/\s+/g, ''))) {
      await page.locator('.workspace-select').click();
      await page.locator('.ant-select-item-option').filter({ hasText: expectedRepository }).first().click();
      await page.waitForTimeout(500);
    }
    const selectedMeta = await page.locator('.workspace-card-meta').innerText();
    assert(selectedMeta.replace(/\s+/g, '').includes(expectedRepository.replace(/\s+/g, '')), '侧栏当前工作区未显示监听仓库');
  }
  const workspaceBase = new URL(page.url()).pathname.replace(/\/$/, '');
  await page.screenshot({ path: '.run/screens/01-dashboard.png', fullPage: true });

  for (const [path, heading] of [[`${workspaceBase}/review`, '复核中心'], [`${workspaceBase}/schedule`, '执行调度'],
    [`${workspaceBase}/executions`, '交付记录'], [`${workspaceBase}/audit`, '审计日志'], ['/workspaces', '工作区与仓库'],
    ['/analytics', '全局统计'], ['/settings', '系统设置']]) {
    await page.goto(`http://127.0.0.1:5173${path}`, { waitUntil: 'networkidle' });
    console.log(`SMOKE_NAV ${path} -> ${new URL(page.url()).pathname} :: ${heading}`);
    await page.getByRole('heading', { name: heading }).waitFor();
    if (path === '/workspaces') {
      const table = page.locator('.ant-table-content').first();
      const overflow = await table.evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth }));
      assert(overflow.scroll <= overflow.client + 1, '桌面端工作区表格仍被横向裁切');
      await page.screenshot({ path: '.run/screens/02-workspaces.png', fullPage: true });
    }
    if (path === '/analytics') {
      const table = page.locator('.ant-table-content').first();
      const scrollable = await table.evaluate(node => node.scrollWidth > node.clientWidth);
      assert(scrollable, '全局统计宽表没有提供横向滚动');
      await page.screenshot({ path: '.run/screens/03-analytics.png', fullPage: true });
    }
  }
  await page.screenshot({ path: '.run/screens/04-settings.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:5173${workspaceBase}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '打开导航' }).click();
  const drawer = page.locator('.ant-drawer-content-wrapper');
  await drawer.waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  const drawerBox = await drawer.boundingBox();
  assert(await drawer.isVisible(), '移动端侧边栏未打开');
  assert((drawerBox?.width ?? 0) >= 260, '移动端侧边栏宽度不足');
  await page.screenshot({ path: '.run/screens/05-mobile-menu.png', fullPage: true });

  const result = { ok: true, consoleErrors, pageErrors, requestFailures,
    screenshots: ['01-dashboard.png', '02-workspaces.png', '03-analytics.png', '04-settings.png', '05-mobile-menu.png'] };
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
