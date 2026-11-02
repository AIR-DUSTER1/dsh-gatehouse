import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const requestFailures = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText}`));

function assert(condition, message) { if (!condition) throw new Error(message); }

try {
  await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '.run/screens/01-login.png', fullPage: true });
  assert(await page.getByRole('heading', { name: '登录控制台' }).isVisible(), '登录页未渲染');

  await page.getByLabel('工作邮箱').fill('li@example.com');
  await page.getByLabel('密码').fill('demo123');
  await page.getByRole('button', { name: '进入控制台' }).click();
  await page.waitForURL('http://127.0.0.1:5173/', { timeout: 15000 });
  await page.getByRole('heading', { name: /早上好|下午好|晚上好/ }).waitFor();
  await page.screenshot({ path: '.run/screens/02-dashboard.png', fullPage: true });

  await page.getByRole('menuitem', { name: '复核中心' }).click();
  await page.waitForURL('**/review');
  await page.locator('table tbody tr:not(.ant-table-measure-row)').first().waitFor();
  assert(await page.locator('table tbody tr:not(.ant-table-measure-row)').count() > 0, '复核列表为空');
  await page.screenshot({ path: '.run/screens/03-review-queue.png', fullPage: true });

  await page.locator('table tbody tr:not(.ant-table-measure-row) a').first().click();
  await page.waitForURL('**/review/*');
  await page.getByText('人工复核决策', { exact: true }).waitFor();
  await page.screenshot({ path: '.run/screens/04-case-detail.png', fullPage: true });

  await page.locator('.decision-actions').getByRole('button', { name: '批准并排期' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.locator('textarea').fill('浏览器自测：范围、风险和测试计划均已确认，批准进入排期。');
  await dialog.locator('input[type="checkbox"]').check();
  await page.screenshot({ path: '.run/screens/05-approval-modal.png', fullPage: true });
  await dialog.getByRole('button', { name: '批准并排期' }).click();
  await page.getByText('审批已完成，任务已进入排期。').waitFor({ timeout: 15000 });
  await page.getByText('已排期', { exact: true }).first().waitFor();
  await page.screenshot({ path: '.run/screens/06-case-scheduled.png', fullPage: true });

  await page.getByRole('menuitem', { name: '执行调度' }).click();
  await page.waitForURL('**/schedule');
  await page.getByText('执行调度', { exact: true }).first().waitFor();
  await page.screenshot({ path: '.run/screens/07-schedule.png', fullPage: true });

  await page.getByRole('menuitem', { name: '交付记录' }).click();
  await page.waitForURL('**/executions');
  await page.getByRole('heading', { name: '交付记录' }).waitFor();
  await page.screenshot({ path: '.run/screens/08-executions.png', fullPage: true });

  await page.getByRole('menuitem', { name: '审计日志' }).click();
  await page.waitForURL('**/audit');
  await page.locator('table tbody tr:not(.ant-table-measure-row)').first().waitFor();
  await page.screenshot({ path: '.run/screens/09-audit.png', fullPage: true });

  await page.getByRole('menuitem', { name: '系统设置' }).click();
  await page.waitForURL('**/settings');
  await page.getByRole('heading', { name: '系统设置' }).waitFor();
  await page.screenshot({ path: '.run/screens/10-settings.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '.run/screens/11-mobile-dashboard.png', fullPage: true });
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.locator('.ant-drawer-content-wrapper').waitFor({ state: 'visible' });
  assert(await page.locator('.ant-drawer-content-wrapper').isVisible(), '移动端侧边栏未打开');
  await page.screenshot({ path: '.run/screens/12-mobile-menu.png', fullPage: true });

  const result = {
    ok: true,
    url: page.url(),
    consoleErrors,
    pageErrors,
    requestFailures,
    screenshots: [
      '01-login.png','02-dashboard.png','03-review-queue.png','04-case-detail.png','05-approval-modal.png',
      '06-case-scheduled.png','07-schedule.png','08-executions.png','09-audit.png','10-settings.png','11-mobile-dashboard.png','12-mobile-menu.png',
    ],
  };
  writeFileSync('.run/browser-smoke.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
} catch (error) {
  const result = { ok: false, error: error instanceof Error ? error.stack : String(error), consoleErrors, pageErrors, requestFailures };
  writeFileSync('.run/browser-smoke.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: '.run/screens/failure.png', fullPage: true }).catch(() => {});
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}




