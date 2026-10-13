const { test, expect } = require('@playwright/test');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173/';

test.describe('Luma Local Photo Lab browser smoke', () => {
  test('loads app, edits a real canvas image, supports history and exports', async ({ page }) => {
    test.setTimeout(90000);
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
    if (!(await page.locator('#filename').innerText()).includes('luma-smoke-test.png')) throw new Error(`Image did not load; pageErrors=${JSON.stringify(pageErrors)}; filename=${await page.locator('#filename').innerText()}`);
    await expect(page.locator('#compareBtn')).toBeEnabled();
    await expect(page.locator('#exportBtn')).toBeEnabled();

    // Transform controls live in the Crop/Transform tool panel; open that panel before testing them.
    await page.locator('[data-tool="crop"]').click();
    await expect(page.locator('[data-tool-panel="crop"]')).toBeVisible();

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

    // Sized export is inside the advanced section of the Mask tool, so reveal it first.
    await page.locator('[data-tool="mask"]').click();
    const advanced = page.locator('details.mask-extra.mask-group[data-mask-subgroup="advanced"]');
    await advanced.locator('summary').click();
    await expect(page.locator('#exportSizedJpeg')).toBeVisible();
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.locator('#exportSizedJpeg').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.(jpe?g)$/i);
    expect((await download.createReadStream()).readable).toBeTruthy();

    await page.locator('[data-tool="color"]').click();
    await expect(page.locator('[data-tool="color"]')).toHaveClass(/active/);
    await expect(page.locator('[data-tool-panel="color"]')).toBeVisible();
    await page.locator('[data-tool="mask"]').click();
    await expect(page.locator('[data-tool-panel="mask"]')).toBeVisible();
    await page.locator('[data-tool="library"]').click();
    await expect(page.locator('[data-side-panel="library"]')).toBeVisible();

    expect(pageErrors, 'uncaught browser errors').toEqual([]);
  });

  test('all primary tool navigation and feature panels respond without runtime errors', async ({ page }) => {
    test.setTimeout(60000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const toolButtons = page.locator('[data-tool]');
    const count = await toolButtons.count();
    expect(count).toBeGreaterThanOrEqual(8);
    const visited = [];
    for (let i = 0; i < count; i++) {
      const button = toolButtons.nth(i);
      const tool = await button.getAttribute('data-tool');
      if (!tool || visited.includes(tool)) continue;
      visited.push(tool);
      await button.click();
      await expect(button).toHaveClass(/active/);
      const panel = page.locator(`[data-tool-panel="${tool}"]`).first();
      const sidePanel = page.locator(`[data-side-panel="${tool}"]`).first();
      if (await panel.count()) await expect(panel).toBeVisible();
      else if (await sidePanel.count()) await expect(sidePanel).toBeVisible();
    }
    expect(visited.length).toBeGreaterThanOrEqual(8);
    expect(pageErrors, 'uncaught errors while switching tools').toEqual([]);
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
    await expect(page.locator('[data-tool="color"]')).toHaveClass(/active/);
    await expect(page.locator('[data-tool-panel="color"]')).toBeVisible();
    await page.locator('[data-tool="adjust"]').click();
    await expect(page.locator('[data-tool-panel="adjust"]')).toBeVisible();
    expect(pageErrors, 'uncaught mobile browser errors').toEqual([]);
  });
});
