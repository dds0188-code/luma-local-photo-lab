const { test, expect } = require('@playwright/test');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173/';

test.describe('Luma Local Photo Lab browser smoke', () => {
  test('loads app, edits a real canvas image, supports history and exports', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await expect(page).toHaveTitle(/Luma Local Photo Lab/i);
    await expect(page.locator('#openBtn')).toBeVisible();
    await expect(page.locator('#preview')).toBeAttached();

    // Generate a deterministic test photograph in-browser; no private user photo is uploaded to CI.
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 320; c.height = 240;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 320, 240);
      g.addColorStop(0, '#214f91'); g.addColorStop(.5, '#e9b86a'); g.addColorStop(1, '#3e7852');
      x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#f2d3bd'; x.beginPath(); x.arc(160, 92, 44, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#20242b'; x.fillRect(105, 140, 110, 80);
      return c.toDataURL('image/png');
    });
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    await page.locator('#fileInput').setInputFiles({ name: 'luma-smoke-test.png', mimeType: 'image/png', buffer });
    await expect.poll(() => page.locator('#preview').evaluate(c => c.width)).toBeGreaterThan(0);
    await expect.poll(() => page.locator('#preview').evaluate(c => c.height)).toBeGreaterThan(0);
    await expect(page.locator('#filename')).toContainText('luma-smoke-test.png');
    await expect(page.locator('#compareBtn')).toBeEnabled();
    await expect(page.locator('#exportBtn')).toBeEnabled();

    const before = await page.locator('#preview').evaluate(c => {
      const x = c.getContext('2d'); return [...x.getImageData(80, 80, 1, 1).data];
    });
    const slider = page.locator('#angleRange');
    await expect(slider).toBeVisible();
    await slider.evaluate(el => {
      const min = Number(el.min || 0), max = Number(el.max || 100);
      el.value = String(Math.min(max, Math.max(min, 30)));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(350);
    const after = await page.locator('#preview').evaluate(c => [...c.getContext('2d').getImageData(80, 80, 1, 1).data]);
    expect(after).not.toEqual(before);

    await page.locator('#undo').click();
    await page.waitForTimeout(250);
    await page.locator('#redo').click();
    await page.waitForTimeout(250);
    await page.locator('#compareBtn').click();
    await expect(page.locator('#compareLabel')).not.toHaveClass(/hidden/);
    await page.locator('#compareBtn').click();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportSizedJpeg').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.(jpe?g)$/i);
    expect((await download.createReadStream()).readable).toBeTruthy();

    await page.locator('[data-tool="color"]').click();
    await expect(page.locator('[data-tool-panel="color"]')).toBeVisible();
    await page.locator('[data-tool="mask"]').click();
    await expect(page.locator('[data-tool-panel="mask"]')).toBeVisible();
    await page.locator('[data-tool="library"]').click();
    await expect(page.locator('[data-side-panel="library"]')).toBeVisible();

    expect(pageErrors, 'uncaught browser errors').toEqual([]);
  });

  test('mobile viewport remains within screen width and key controls are usable', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await expect(page.locator('#openBtn')).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 2);
    await page.locator('[data-tool="color"]').click();
    await expect(page.locator('[data-tool-panel="color"]')).toBeVisible();
    await page.locator('[data-tool="adjust"]').click();
    await expect(page.locator('[data-tool-panel="adjust"]')).toBeVisible();
    expect(pageErrors, 'uncaught mobile browser errors').toEqual([]);
  });
});
