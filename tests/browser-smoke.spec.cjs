const { test, expect } = require('@playwright/test');
const fs = require('fs');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173/';

test.describe('Luma Local Photo Lab browser smoke', () => {
  test('loads app, edits a real canvas image, supports history and exports', async ({ page }) => {
    test.setTimeout(120000);
    page.setDefaultTimeout(7000);
    page.setDefaultNavigationTimeout(15000);
    const traceStep = (name) => console.log(`[DIAG] ${name}`);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    traceStep('open app');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Luma Local Photo Lab/i);
    await expect(page.locator('#openBtn')).toBeVisible();
    await expect(page.locator('#preview')).toBeAttached();

    // Generate a deterministic test photograph in-browser; no private user photo is uploaded to CI.
    traceStep('generate synthetic image');
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
    traceStep('upload image');
    await page.locator('#fileInput').setInputFiles({ name: 'luma-smoke-test.png', mimeType: 'image/png', buffer });
    await expect.poll(() => page.locator('#preview').evaluate(c => c.width)).toBeGreaterThan(0);
    await expect.poll(() => page.locator('#preview').evaluate(c => c.height)).toBeGreaterThan(0);
    await expect.poll(() => page.locator('#filename').innerText(), { timeout: 15000 }).toContain('luma-smoke-test.png');
    await expect(page.locator('#compareBtn')).toBeEnabled();
    await expect(page.locator('#exportBtn')).toBeEnabled();

    // Transform controls live in the Crop/Transform tool panel; open that panel before testing them.
    traceStep('open transform panel');
    await page.locator('[data-tool="crop"]').click();
    await expect(page.locator('[data-tool-panel="crop"]')).toBeVisible();

    traceStep('read initial canvas pixels');
    const before = await page.locator('#preview').evaluate(c => {
      const x = c.getContext('2d'); return [...x.getImageData(80, 80, 1, 1).data];
    });
    const slider = page.locator('#angleRange');
    await expect(slider).toBeVisible();
    traceStep('change angle slider');
    await slider.evaluate(el => {
      const min = Number(el.min || 0), max = Number(el.max || 100);
      el.value = String(Math.min(max, Math.max(min, 30)));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(350);
    const after = await page.locator('#preview').evaluate(c => [...c.getContext('2d').getImageData(80, 80, 1, 1).data]);
    expect(after).not.toEqual(before);

    traceStep('undo and redo');
    await page.locator('#undo').click();
    await page.waitForTimeout(250);
    await page.locator('#redo').click();
    await page.waitForTimeout(250);
    traceStep('compare before after');
    await page.locator('#compareBtn').click();
    await expect(page.locator('#compareLabel')).not.toHaveClass(/hidden/);
    await page.locator('#compareBtn').click();

    // Sized export is inside the advanced section of the Mask tool, so reveal it first.
    traceStep('open advanced export panel');
    await page.locator('[data-tool="mask"]').click();
    await page.locator('[data-mask-view="advanced"]').click();
    const advanced = page.locator('details.mask-extra.mask-group[data-mask-subgroup="advanced"]');
    if (!(await advanced.evaluate(el => el.open))) await advanced.locator('summary').click();
    await expect(page.locator('#exportSizedJpeg')).toBeVisible();
    traceStep('trigger sized jpeg download');
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.locator('#exportSizedJpeg').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.(jpe?g)$/i);
    expect((await download.createReadStream()).readable).toBeTruthy();

    traceStep('verify color mask library panels');
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


  test('photo workflows: presets, local AI analysis, area selection, masks, library and exports', async ({ page }) => {
    test.setTimeout(90000);
    page.setDefaultTimeout(7000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 240;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 320, 240);
      g.addColorStop(0, '#214f91'); g.addColorStop(.5, '#e9b86a'); g.addColorStop(1, '#3e7852');
      x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#f2d3bd'; x.beginPath(); x.arc(160, 92, 44, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#20242b'; x.fillRect(105, 140, 110, 80);
      return c.toDataURL('image/png');
    });
    await page.locator('#fileInput').setInputFiles({
      name: 'luma-feature-test.png', mimeType: 'image/png',
      buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
    });
    await expect(page.locator('#saveToLibrary')).toBeEnabled();

    await page.locator('[data-tool="presets"]').click();
    await expect(page.locator('[data-side-panel="presets"]')).toBeVisible();
    await expect(page.locator('.preset').first()).toBeVisible();
    await page.locator('.preset').first().click();
    await page.locator('#presetName').fill('CI Test Preset');
    await page.locator('#savePreset').click();
    await expect(page.locator('#customPresets')).toContainText('CI Test Preset');
    await page.locator('#search').fill('portrait');
    await expect(page.locator('#search')).toHaveValue('portrait');
    await page.locator('#search').fill('');
    await expect(page.locator('.preset').first()).toBeVisible();

    // AI is local brightness/color analysis, not semantic person segmentation.
    await page.locator('[data-tool="ai"]').click();
    await expect(page.locator('#aiAnalyze')).toBeEnabled();
    await page.locator('#aiAnalyze').click();
    await expect(page.locator('#aiAuto')).toBeEnabled();
    await expect(page.locator('#aiSummary')).not.toContainText('사진을 열면 분석 결과가 표시됩니다.');
    await page.locator('#aiAuto').click();

    await page.locator('[data-tool="area"]').click();
    await page.locator('#areaSkyRun').click();
    await expect(page.locator('#areaStatus')).not.toBeEmpty();

    await page.locator('[data-tool="mask"]').click();
    const beforeLayers = await page.locator('#maskLayerSelect option').count();
    await page.locator('#maskAddLayer').click();
    await expect.poll(() => page.locator('#maskLayerSelect option').count()).toBeGreaterThan(beforeLayers);
    await expect(page.locator('#maskLayerSelect')).toBeVisible();

    await page.locator('[data-tool="library"]').click();
    await page.locator('#saveToLibrary').click();
    await expect(page.locator('#libraryItems')).not.toBeEmpty();

    await page.locator('[data-tool="mask"]').click();
    await page.locator('[data-mask-view="advanced"]').click();
    const advanced = page.locator('details.mask-extra.mask-group[data-mask-subgroup="advanced"]');
    if (!(await advanced.evaluate(el => el.open))) await advanced.locator('summary').click();
    const jpegPromise = page.waitForEvent('download', { timeout: 12000 });
    await page.locator('#exportWatermarked').click();
    const jpeg = await jpegPromise;
    expect(jpeg.suggestedFilename()).toMatch(/\.jpe?g$/i);
    const pngPromise = page.waitForEvent('download', { timeout: 12000 });
    await page.locator('#exportSizedPng').click();
    const png = await pngPromise;
    expect(png.suggestedFilename()).toMatch(/\.png$/i);
    const metadataPromise = page.waitForEvent('download', { timeout: 12000 });
    await page.locator('#downloadMetadata').click();
    const metadata = await metadataPromise;
    expect(metadata.suggestedFilename()).toMatch(/\.json$/i);

    expect(pageErrors, 'uncaught errors in photo workflows').toEqual([]);
  });


  test('project files, export profiles, frame output and foreground selection', async ({ page }) => {
    test.setTimeout(90000);
    page.setDefaultTimeout(7000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 240; c.height = 180;
      const x = c.getContext('2d'); x.fillStyle = '#3268a4'; x.fillRect(0, 0, 240, 180);
      x.fillStyle = '#f0c49a'; x.beginPath(); x.arc(120, 62, 34, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2f6544'; x.fillRect(78, 98, 84, 70);
      return c.toDataURL('image/png');
    });
    await page.locator('#fileInput').setInputFiles({
      name: 'luma-project-test.png', mimeType: 'image/png',
      buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
    });

    await page.locator('[data-tool="mask"]').click();
    await page.locator('[data-mask-view="advanced"]').click();
    const advancedProject = page.locator('details.mask-extra.mask-group[data-mask-subgroup="advanced"]');
    if (!(await advancedProject.evaluate(el => el.open))) await advancedProject.locator('summary').click();
    const projectPromise = page.waitForEvent('download', { timeout: 12000 });
    await page.locator('#saveProjectJson').click();
    const project = await projectPromise;
    expect(project.suggestedFilename()).toMatch(/\.json$/i);
    const recipePromise = page.waitForEvent('download', { timeout: 12000 });
    await page.locator('[data-tool="files"]').click();
    await page.locator('#saveRecipe').click();
    const recipe = await recipePromise;
    expect(recipe.suggestedFilename()).toMatch(/\.json$/i);

    await page.locator('[data-tool="mask"]').click();
    await page.locator('[data-mask-view="advanced"]').click();
    await page.locator('#exportProfileName').fill('CI Export Profile');
    await page.locator('#exportProfileFormat').selectOption('image/png');
    await page.locator('#saveExportProfile').click();
    await expect(page.locator('#exportProfileStatus')).toContainText('CI Export Profile');
    await expect(page.locator('#exportProfileSelect')).toContainText('CI Export Profile');
    await page.locator('#exportProfileSelect').selectOption({ label: 'CI Export Profile' });
    await page.locator('#applyExportProfile').click();
    await expect(page.locator('#exportProfileStatus')).not.toBeEmpty();

    await page.locator('#exportFramed').evaluate(el => {
      let parent = el.closest('details');
      while (parent) { parent.open = true; parent = parent.parentElement.closest('details'); }
    });
    const framePromise = page.waitForEvent('download', { timeout: 12000 });
    await page.locator('#exportFramed').click();
    const frame = await framePromise;
    expect(frame.suggestedFilename()).toMatch(/framed\.jpg$/i);

    await page.locator('[data-tool="cutout"]').click();
    await page.locator('#cutoutAutoSelect').click();
    await expect(page.locator('#magicSelectApply')).toBeEnabled({ timeout: 12000 });
    await page.locator('#magicSelectApply').click();
    const cutoutPromise = page.waitForEvent('download', { timeout: 12000 });
    await page.locator('#exportCutout').click();
    const cutout = await cutoutPromise;
    expect(cutout.suggestedFilename()).toMatch(/cutout\.png$/i);
    expect(pageErrors, 'uncaught project/export/cutout errors').toEqual([]);
  });

  test('mobile browser: image editing, presets, masks, AI, area tools and export', async ({ page }) => {
    test.setTimeout(90000);
    page.setDefaultTimeout(7000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#openBtn')).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 2);
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 240; c.height = 180;
      const x = c.getContext('2d'); x.fillStyle = '#3768a0'; x.fillRect(0, 0, 240, 180);
      x.fillStyle = '#e7b27a'; x.beginPath(); x.arc(120, 65, 35, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#315b43'; x.fillRect(75, 105, 90, 65);
      return c.toDataURL('image/png');
    });
    await page.locator('#fileInput').setInputFiles({
      name: 'luma-mobile-test.png', mimeType: 'image/png',
      buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
    });

    await page.locator('[data-tool="adjust"]').click();
    await expect(page.locator('[data-tool-panel="adjust"]')).toBeVisible();
    await page.locator('[data-tool="color"]').click();
    await expect(page.locator('[data-tool-panel="color"]')).toBeVisible();
    await page.locator('[data-tool="crop"]').click();
    await expect(page.locator('#angleRange')).toBeVisible();
    await page.locator('#angleRange').evaluate(el => {
      el.value = '12';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#undo')).toBeEnabled();
    await page.locator('#undo').click();
    await page.locator('#redo').click();

    await page.locator('[data-tool="presets"]').click();
    await expect(page.locator('.preset').first()).toBeVisible();
    await page.locator('.preset').first().click();
    await page.locator('[data-tool="mask"]').click();
    const layerCount = await page.locator('#maskLayerSelect option').count();
    await page.locator('#maskAddLayer').click();
    await expect.poll(() => page.locator('#maskLayerSelect option').count()).toBeGreaterThan(layerCount);

    await page.locator('[data-tool="area"]').click();
    await page.locator('#areaSkyRun').click();
    await expect(page.locator('#areaStatus')).toBeVisible();
    await page.locator('[data-tool="ai"]').click();
    await page.locator('#aiAnalyze').click();
    await expect(page.locator('#aiAuto')).toBeEnabled();
    await page.locator('#aiAuto').click();

    await page.locator('[data-tool="mask"]').click();
    await page.locator('[data-mask-view="advanced"]').click();
    const advanced = page.locator('details.mask-extra.mask-group[data-mask-subgroup="advanced"]');
    if (!(await advanced.evaluate(el => el.open))) await advanced.locator('summary').click();
    const downloadPromise = page.waitForEvent('download', { timeout: 12000 });
    await page.locator('#exportSizedJpeg').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.jpe?g$/i);
    expect(pageErrors, 'uncaught mobile browser errors').toEqual([]);
  });
  test('rapid consecutive photo imports keep the most recently selected image', async ({ page }) => {
    test.setTimeout(30000);
    page.setDefaultTimeout(7000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const makePng = async (width, height, color) => {
      const dataUrl = await page.evaluate(({ width, height, color }) => {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
        return canvas.toDataURL('image/png');
      }, { width, height, color });
      return Buffer.from(dataUrl.split(',')[1], 'base64');
    };
    const input = page.locator('#fileInput');
    await input.setInputFiles({ name: 'first-photo.png', mimeType: 'image/png', buffer: await makePng(2200, 1600, '#cc3344') });
    await input.setInputFiles({ name: 'latest-photo.png', mimeType: 'image/png', buffer: await makePng(320, 240, '#3366cc') });
    await expect.poll(() => page.locator('#filename').innerText(), { timeout: 15000 }).toContain('latest-photo.png');
    await expect.poll(() => page.locator('#meta').innerText()).toContain('320 × 240');
    expect(pageErrors, 'uncaught browser errors during rapid imports').toEqual([]);
  });

  test('manual relighting changes rendered pixels, supports presets, reset, and exports without runtime errors', async ({ page }) => {
    test.setTimeout(60000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 240; c.height = 180;
      const x = c.getContext('2d'); x.fillStyle = '#555b60'; x.fillRect(0, 0, 240, 180);
      return c.toDataURL('image/png');
    });
    await page.locator('#fileInput').setInputFiles({
      name: 'luma-relight-test.png', mimeType: 'image/png',
      buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
    });
    await expect.poll(() => page.locator('#filename').innerText()).toContain('luma-relight-test.png');
    await page.locator('[data-tool="relight"]').click();
    await expect(page.locator('[data-tool-panel="relight"]')).toBeVisible();
    const before = await page.locator('#preview').evaluate(c => [...c.getContext('2d').getImageData(120, 65, 1, 1).data]);
    await page.locator('#relightPresetWarm').click();
    await page.waitForTimeout(400);
    const after = await page.locator('#preview').evaluate(c => [...c.getContext('2d').getImageData(120, 65, 1, 1).data]);
    expect(after).not.toEqual(before);
    await expect(page.locator('#relightStatus')).toContainText('적용 중');
    await page.locator('#relightType').selectOption('linear');
    await page.locator('#relightAngle').fill('25');
    await page.locator('#relightAngle').dispatchEvent('input');
    await page.waitForTimeout(200);
    await page.locator('#relightReset').click();
    await expect(page.locator('#relightStatus')).toContainText('꺼짐');
    expect(pageErrors, 'uncaught relighting errors').toEqual([]);
  });

});


test('mask regression: visible overlays, editable individual shapes, non-destructive split, and distinct Instagram looks', async ({ page }) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  page.on('pageerror', error => { pageErrors.push(error.message); console.log('[MASK PAGEERROR]', error.message); });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 360; c.height = 240;
    const x = c.getContext('2d'); x.fillStyle = '#263e62'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#d9b18a'; x.beginPath(); x.arc(180, 95, 45, 0, Math.PI * 2); x.fill();
    return c.toDataURL('image/png');
  });
  await page.locator('#fileInput').setInputFiles({
    name: 'luma-mask-regression.png', mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
  });
  await expect.poll(() => page.locator('#filename').innerText(), { timeout: 15000 }).toContain('luma-mask-regression.png');
  await page.locator('[data-tool="mask"]').click();
  await page.locator('[data-mask-view="paint"]').click();
  await page.locator('#maskToggle').click();
  await page.locator('[data-mask-mode="ellipse"]').click();
  const overlay = page.locator('#maskOverlay');
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  const drag = async (x1, y1, x2, y2) => {
    await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 5 });
    await page.mouse.up();
  };
  await drag(.24, .25, .48, .55);
  await drag(.56, .25, .80, .55);
  await expect(page.locator('#maskShapeEdit')).toBeEnabled();
  await expect(page.locator('#maskLayerSelect option').first()).toBeAttached();
  await page.locator('#maskShapeEdit').click();
  await expect(page.locator('#maskShapeControls')).toBeVisible();
  const originalShapeX = Number(await page.locator('#maskShapeX').inputValue());
  await page.locator('#maskShapeX').fill(String(Math.max(0, Math.min(100, originalShapeX - 10))));
  await expect(page.locator('#maskShapeXRange')).toHaveValue(String(Math.max(0, Math.min(100, originalShapeX - 10))));
  await expect(page.locator('#maskOverlayToggle')).toContainText('숨기기');
  await page.locator('#maskOverlayToggle').click();
  await expect(page.locator('#maskOverlayToggle')).toContainText('표시');
  await page.locator('[data-mask-view="layers"]').click();
  const splitGroup = page.locator('[data-tool-panel="mask"] details.ui-group').filter({ hasText: '마스크 분할 도구' });
  if (!(await splitGroup.evaluate(el => el.open))) await splitGroup.locator('summary').click();
  await page.locator('#maskSplit2H').click();
  await expect(page.locator('#maskLayerSelect option')).toHaveCount(2);
  await expect(page.locator('#maskSplitAdjust')).toBeVisible();
  await page.locator('#maskSplitBoundary1').evaluate(el => { el.value = '62'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#maskSplitBoundary1')).toHaveValue('62');
  await expect(page.locator('#maskSplitBoundary1Value')).toHaveText('62%');
  await page.locator('[data-tool="presets"]').click();
  const presetLabels = await page.locator('.preset').allTextContents();
  expect(presetLabels.length).toBeGreaterThanOrEqual(25);
  expect(new Set(presetLabels).size).toBeGreaterThanOrEqual(25);
  expect(pageErrors, 'uncaught mask workflow errors').toEqual([]);
});


test('crop coordinates stay aligned before and after preview zoom on desktop and mobile viewports', async ({ page }) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 500) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#214f91'; x.fillRect(0, 0, 400, 300);
    x.fillStyle = '#e9b86a'; x.fillRect(100, 75, 200, 150);
    return c.toDataURL('image/png');
  });
  await page.locator('#fileInput').setInputFiles({
    name: 'luma-crop-coordinate-test.png', mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
  });
  await expect.poll(() => page.locator('#filename').innerText()).toContain('luma-crop-coordinate-test.png');
  await page.locator('[data-tool="crop"]').click();
  await expect(page.locator('#cropOverlay')).toBeVisible();

  const dragCrop = async () => {
    const rect = await page.locator('#preview').boundingBox();
    expect(rect).not.toBeNull();
    await page.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.7, rect.y + rect.height * 0.7, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('#cropXNum')).toHaveValue('20');
    await expect(page.locator('#cropYNum')).toHaveValue('20');
    await expect(page.locator('#cropWNum')).toHaveValue('50');
    await expect(page.locator('#cropHNum')).toHaveValue('50');
  };

  // Desktop: the same normalized crop must be selected at 100% and zoomed preview sizes.
  await dragCrop();
  await page.locator('#cropReset').click();
  await page.locator('#zoomIn').click();
  await page.waitForTimeout(150);
  await dragCrop();
  await expect(page.locator('#cropPixelInfo')).toContainText('200 × 150 px');

  // Repeat on a phone-sized viewport without re-importing the image.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(180);
  await page.locator('#zoomFit').click();
  await page.locator('#cropReset').click();
  await dragCrop();
  await page.locator('#cropReset').click();
  await page.locator('#zoomIn').click();
  await page.waitForTimeout(180);
  await dragCrop();
  await expect(page.locator('#cropPixelInfo')).toContainText('200 × 150 px');
  expect(errors, 'uncaught crop coordinate errors').toEqual([]);
});

test('full library ZIP backup restores original photos and metadata without deleting existing items', async ({ page }) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 120;
    const x = c.getContext('2d'); x.fillStyle = '#345b91'; x.fillRect(0, 0, 160, 120);
    x.fillStyle = '#f0c5a5'; x.beginPath(); x.arc(80, 45, 22, 0, Math.PI * 2); x.fill();
    return c.toDataURL('image/png');
  });
  await page.locator('#fileInput').setInputFiles({
    name: 'luma-zip-restore-test.png', mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
  });
  // Safari/WebKit can dispatch file selection before the asynchronous image decode finishes.
  await expect.poll(() => page.locator('#filename').innerText(), { timeout: 15000 }).toContain('luma-zip-restore-test.png');
  await expect(page.locator('#saveToLibrary')).toBeEnabled();
  await page.locator('[data-tool="library"]').click();
  await page.locator('#saveToLibrary').click();
  await expect(page.locator('#libraryItems .library-row')).toHaveCount(1, { timeout: 15000 });
  const keywords = page.locator('#libraryItems .library-row input[type="text"]');
  await keywords.fill('zip-test, metadata-roundtrip');
  await keywords.dispatchEvent('change');
  await expect(page.locator('#toast')).toContainText('키워드를 저장했습니다', { timeout: 10000 });

  await page.locator('#libraryActionGroups summary').filter({ hasText: '백업 · 복원' }).click();
  await expect(page.locator('#backupFullLibrary')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.locator('#backupFullLibrary').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/luma-full-library-backup-.*\.zip$/i);
  const zipPath = await download.path();
  expect(zipPath).toBeTruthy();

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#fullLibraryZipFile').setInputFiles(zipPath);
  await expect(page.locator('#libraryBulkStatus')).toContainText('ZIP 복원 완료', { timeout: 15000 });
  await expect(page.locator('#libraryItems .library-row')).toHaveCount(2);
  await expect(page.locator('#libraryOverview')).toContainText('2장');
  await expect(page.locator('#libraryItems .library-row input[type="text"]')).toHaveCount(2);
  await expect(page.locator('#libraryItems .library-row input[type="text"]').nth(0)).toHaveValue('zip-test, metadata-roundtrip');
  await expect(page.locator('#libraryItems .library-row input[type="text"]').nth(1)).toHaveValue('zip-test, metadata-roundtrip');
  expect(errors, 'uncaught library ZIP restore errors').toEqual([]);
});

test('adjustment subtabs remain in layout flow and never overlay the photo preview', async ({ page }) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d'); x.fillStyle = '#8ba5c1'; x.fillRect(0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  });
  await page.locator('#fileInput').setInputFiles({name:'submenu-layout-test.png',mimeType:'image/png',buffer:Buffer.from(dataUrl.split(',')[1],'base64')});
  await expect.poll(() => page.locator('#preview').evaluate(c => c.width)).toBeGreaterThan(0);
  await page.locator('[data-tool="adjust"]').click();
  const nav = page.locator('#basicSubnav');
  await expect(nav).toBeVisible();
  expect(await nav.evaluate(el => getComputedStyle(el).position)).not.toBe('sticky');
  expect(await nav.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(0);
  const preview = page.locator('#preview');
  const navBox = await nav.boundingBox();
  const previewBox = await preview.boundingBox();
  expect(navBox.y + navBox.height <= previewBox.y || navBox.y >= previewBox.y + previewBox.height).toBeTruthy();
  await nav.locator('button').filter({ hasText: '자동 보정' }).click();
  expect(await nav.evaluate(el => getComputedStyle(el).position)).not.toBe('sticky');
});

test('light/tone and auto adjustment tabs sit beside color, effects and detail without sticky overlays', async ({ page }) => {
  test.setTimeout(45000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-tool="adjust"]').click();
  const nav = page.locator('#basicSubnav');
  await expect(nav.locator('button')).toHaveCount(6);
  await expect(nav.locator('button').nth(0)).toHaveText('자동 보정');
  await expect(nav.locator('button').nth(1)).toHaveText('빛·톤');
  await expect(nav.locator('button').nth(2)).toHaveText('색상');
  await expect(nav.locator('button').nth(3)).toHaveText('효과');
  await expect(nav.locator('button').nth(4)).toHaveText('디테일');
  await expect(page.locator('.adjust-subnav')).not.toHaveCSS('position', 'sticky');
  expect(await page.locator('.panel-subnav').evaluateAll(els => els.every(el => getComputedStyle(el).position !== 'sticky'))).toBeTruthy();
  await nav.locator('button').filter({ hasText: '자동 보정' }).click();
  await expect(page.locator('.adjust-utility-panel[data-adjust-utility="auto"] #autoToneQuick')).toBeAttached();
  await expect(page.locator('.adjust-utility-panel[data-adjust-utility="auto"] #autoWhiteBalanceQuick')).toBeAttached();
  await expect(page.locator('#basicControls')).toBeHidden();
  await nav.locator('button').filter({ hasText: '빠른 보정' }).click();
  await expect(page.locator('.adjust-utility-panel[data-adjust-utility="quick"] .quick-action-details')).toBeAttached();
  await nav.locator('button').filter({ hasText: '빛·톤' }).click();
  await expect(page.locator('#basicControls')).toBeVisible();
  await expect(page.locator('#basicGroup-light')).toBeVisible();
  await nav.locator('button').filter({ hasText: '색상' }).click();
  await expect(page.locator('#basicGroup-color')).toBeVisible();
  expect(errors, 'horizontal subcategory tabs should not create runtime errors').toEqual([]);
});

test('all editor tools expose compact functional subgroups instead of one long control dump', async ({ page }) => {
  test.setTimeout(45000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const checks = [
    ['presets', '[data-side-panel="presets"] details.ui-group > summary'],
    ['crop', '[data-tool-panel="crop"] details.ui-group > summary'],
    ['color', '[data-tool-panel="color"] .panel-subnav'],
    ['area', '[data-tool-panel="area"] details.ui-group > summary'],
    ['mask', '[data-tool-panel="mask"] details.ui-group > summary'],
    ['cutout', '[data-tool-panel="cutout"] details.ui-group > summary'],
    ['relight', '[data-tool-panel="relight"] details.ui-group > summary'],
    ['ai', '[data-tool-panel="ai"] details.ui-group > summary'],
    ['library', '[data-side-panel="library"] details.library-action-group > summary']
  ];
  for (const [tool, selector] of checks) {
    await page.locator('[data-tool="' + tool + '"]').click();
    await expect(page.locator(selector).first(), tool + ' has navigable subgroups').toBeAttached();
  }
  await page.locator('[data-tool="relight"]').click();
  await expect(page.locator('[data-tool-panel="relight"] details.ui-group > summary').filter({ hasText: '광원 유형·색상' })).toBeAttached();
  await expect(page.locator('[data-tool-panel="relight"] details.ui-group > summary').filter({ hasText: '위치·범위·부드러움' })).toBeAttached();
  expect(errors, 'panel grouping should not create runtime errors').toEqual([]);
});

test('press-and-hold preview compares original and release restores edits; mobile tool strip scrolls horizontally', async ({ page }) => {
  test.setTimeout(45000);
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 120;
    const x = c.getContext('2d'); x.fillStyle = '#527da9'; x.fillRect(0, 0, 160, 120);
    return c.toDataURL('image/png');
  });
  await page.locator('#fileInput').setInputFiles({ name: 'luma-compare-test.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
  await expect.poll(() => page.locator('#filename').innerText()).toContain('luma-compare-test.png');
  await page.locator('#exposureNum').fill('35');
  await page.locator('#exposureNum').dispatchEvent('change');
  await page.waitForTimeout(250);
  const preview = page.locator('#preview');
  await preview.dispatchEvent('pointerdown', { pointerId: 42, pointerType: 'touch', button: 0, clientX: 180, clientY: 220, isPrimary: true });
  await expect(page.locator('#compareLabel')).not.toHaveClass(/hidden/);
  await preview.dispatchEvent('pointerup', { pointerId: 42, pointerType: 'touch', button: 0, clientX: 180, clientY: 220, isPrimary: true });
  await expect(page.locator('#compareLabel')).toHaveClass(/hidden/);
  await expect(page.locator('#exposureNum')).toHaveValue('35');
  const nav = page.locator('#toolNav');
  expect(await nav.locator('button').evaluateAll(nodes => nodes.map(node => node.dataset.tool))).toEqual(['adjust','crop','color','area','mask','relight','cutout','ai','presets','library','files']);
  expect(await nav.locator('[aria-current="page"]').getAttribute('data-tool')).toBe('adjust');
  expect(await nav.evaluate(el => el.scrollWidth > el.clientWidth)).toBeTruthy();
  expect(await nav.evaluate(el => getComputedStyle(el).position)).toBe('fixed');
  for (const [key, tool] of [['2','crop'],['3','color'],['4','area'],['5','mask'],['6','relight'],['7','cutout'],['8','ai'],['9','presets']]) {
    await page.evaluate(key => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })), key);
    await expect(nav.locator(`[data-tool="${tool}"]`)).toHaveAttribute('aria-current', 'page');
  }
  expect(errors, 'press-and-hold compare and mobile toolbar errors').toEqual([]);
});

test('individual adjustment resets on double click and mobile preview stays pinned while controls scroll', async ({ page }) => {
  test.setTimeout(45000);
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 120;
    const x = c.getContext('2d'); x.fillStyle = '#527da9'; x.fillRect(0, 0, 160, 120);
    return c.toDataURL('image/png');
  });
  await page.locator('#fileInput').setInputFiles({ name: 'luma-reset-test.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
  await expect.poll(() => page.locator('#filename').innerText()).toContain('luma-reset-test.png');
  const value = page.locator('#exposureNum');
  await value.fill('36');
  await value.dispatchEvent('change');
  await expect(value).toHaveValue('36');
  await page.locator('#exposure').dblclick();
  await expect(value).toHaveValue('0');
  const stage = page.locator('#stage');
  await expect(stage).toHaveCSS('position', 'relative');
  const stageTop = await stage.evaluate(el => Math.round(el.getBoundingClientRect().top));
  await page.locator('.controls').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => stage.evaluate(el => Math.round(el.getBoundingClientRect().top))).toBe(stageTop);
  expect(errors, 'reset and mobile sticky preview errors').toEqual([]);
});

test('preset tonal balance regression across portrait, landscape, food and night test scenes', async ({ page }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Presets are intentionally scoped inside the app closure; test public UI behavior, not private globals.
  const presetCount = await page.locator('.preset').count();
  expect(presetCount).toBeGreaterThanOrEqual(35);

  const scenes = [
    { name: 'portrait', presets: ['클린 데이라이트', '스튜디오 클린', '스킨 내추럴', '골든 아워', '소프트 필름'], colors: ['#8aafc4', '#e7c4ad', '#4c6b85'] },
    { name: 'landscape', presets: ['내추럴 그린', '포레스트', '스카이 블루', '딥 블루', '드라마틱'], colors: ['#5c9ed8', '#47784a', '#344c35'] },
    { name: 'food', presets: ['카페 라떼', '푸드 팝', '크림 베이지', '골든 아워', '클린 데이라이트'], colors: ['#8d6042', '#e7d8b8', '#bf4b32'] },
    { name: 'night', presets: ['야간 네온', '로우키', '시네마틱', '딥 블루', '드라마틱'], colors: ['#101a38', '#1d9dc7', '#ed3a9d'] }
  ];
  await page.locator('[data-tool="presets"]').click();
  for (const scene of scenes) {
    const dataUrl = await page.evaluate(({ colors, name }) => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 240;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 320, 240);
      g.addColorStop(0, colors[0]); g.addColorStop(.52, colors[1]); g.addColorStop(1, colors[2]);
      x.fillStyle = g; x.fillRect(0, 0, 320, 240);
      if (name === 'portrait') {
        x.fillStyle = '#f0c6a7'; x.beginPath(); x.ellipse(160, 92, 43, 54, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#34313b'; x.beginPath(); x.ellipse(160, 72, 47, 32, 0, Math.PI, Math.PI * 2); x.fill();
        x.fillStyle = '#344a62'; x.beginPath(); x.moveTo(90, 240); x.lineTo(112, 164); x.lineTo(160, 148); x.lineTo(208, 164); x.lineTo(230, 240); x.fill();
      } else if (name === 'landscape') {
        x.fillStyle = '#d7e5ed'; x.beginPath(); x.arc(250, 42, 20, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#42556b'; x.beginPath(); x.moveTo(0, 170); x.lineTo(80, 65); x.lineTo(150, 165); x.lineTo(225, 82); x.lineTo(320, 180); x.lineTo(320, 240); x.lineTo(0, 240); x.fill();
        x.fillStyle = '#33583b'; x.fillRect(0, 188, 320, 52);
      } else if (name === 'food') {
        x.fillStyle = '#f0e4d1'; x.beginPath(); x.ellipse(160, 142, 105, 72, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#c64d32'; x.beginPath(); x.arc(130, 130, 26, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#dfb44d'; x.beginPath(); x.arc(180, 145, 24, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#477a45'; x.beginPath(); x.ellipse(166, 104, 18, 8, -.5, 0, Math.PI * 2); x.fill();
      } else {
        x.fillStyle = '#f13b9d'; x.fillRect(28, 40, 14, 130);
        x.fillStyle = '#19c8ee'; x.fillRect(274, 25, 16, 145);
        x.fillStyle = '#f6b642'; x.beginPath(); x.arc(160, 112, 27, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#17192a'; x.fillRect(70, 172, 180, 68);
      }
      return c.toDataURL('image/png');
    }, scene);
    await page.locator('#fileInput').setInputFiles({
      name: 'preset-test-' + scene.name + '.png',
      mimeType: 'image/png',
      buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
    });
    await expect.poll(() => page.locator('#filename').innerText(), { timeout: 15000 }).toContain('preset-test-' + scene.name + '.png');
    await page.waitForTimeout(120);
    const baseline = await page.locator('#preview').evaluate(c => {
      const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      let n = 0, sum = 0, sum2 = 0;
      for (let i = 0; i < data.length; i += 16) {
        const l = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
        sum += l; sum2 += l * l; n++;
      }
      return Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2));
    });
    expect(baseline).toBeGreaterThan(12);
    for (const name of scene.presets) {
      await page.locator('.preset[data-name="' + name + '"]').click();
      await page.waitForTimeout(180);
      const spread = await page.locator('#preview').evaluate(c => {
        const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        let n = 0, sum = 0, sum2 = 0;
        for (let i = 0; i < data.length; i += 16) {
          const l = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
          sum += l; sum2 += l * l; n++;
        }
        return Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2));
      });
      expect(spread, scene.name + ' / ' + name + ' contrast spread').toBeGreaterThan(baseline * .42);
    }
  }
  expect(pageErrors, 'uncaught errors while testing preset looks').toEqual([]);
});


test('library imports multiple originals with progress and skips duplicate name-size pairs', async ({ page }) => {
  test.setTimeout(45000);
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    const x = c.getContext('2d'); x.fillStyle = '#405b7b'; x.fillRect(0, 0, c.width, c.height);
    return c.toDataURL('image/png').split(',')[1];
  });
  const buffer = Buffer.from(png, 'base64');
  const files = [
    { name: 'library-import-one.png', mimeType: 'image/png', buffer },
    { name: 'library-import-two.png', mimeType: 'image/png', buffer: Buffer.from(buffer) }
  ];
  await page.locator('[data-tool="library"]').click();
  await page.locator('#multiLibraryFiles').setInputFiles(files);
  await expect(page.locator('#libraryImportText')).toContainText('가져오기 완료', { timeout: 15000 });
  await expect(page.locator('#libraryItems .library-row')).toHaveCount(2);
  await expect(page.locator('#libraryOverview')).toContainText('2장');
  await page.locator('#multiLibraryFiles').setInputFiles([files[0]]);
  await expect(page.locator('#libraryImportText')).toContainText('추가 0장 / 중복 1장', { timeout: 15000 });
  await expect(page.locator('#libraryItems .library-row')).toHaveCount(2);
  expect(errors, 'uncaught multi-photo import errors').toEqual([]);
});


test('bounded export renders at target resolution and preserves normalized crop coordinates', async ({ page }) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 3200; c.height = 2400;
    const x = c.getContext('2d');
    x.fillStyle = '#234f91'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#f0c66c'; x.fillRect(640, 480, 1600, 1200);
    return c.toDataURL('image/png');
  });
  await page.locator('#fileInput').setInputFiles({
    name: 'luma-bounded-export-test.png', mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
  });
  await expect.poll(() => page.locator('#filename').innerText()).toContain('luma-bounded-export-test.png');
  await page.locator('[data-tool="crop"]').click();
  await page.locator('#cropWNum').fill('50');
  await page.locator('#cropWNum').dispatchEvent('change');
  await page.locator('#cropHNum').fill('50');
  await page.locator('#cropHNum').dispatchEvent('change');
  await page.locator('#cropXNum').fill('20');
  await page.locator('#cropXNum').dispatchEvent('change');
  await page.locator('#cropYNum').fill('20');
  await page.locator('#cropYNum').dispatchEvent('change');
  await expect(page.locator('#cropPixelInfo')).toContainText('1600 × 1200 px');
  const answers = ['png', '100', '1200', '', 'bounded-output'];
  page.on('dialog', async dialog => {
    const answer = answers.shift();
    await dialog.accept(answer === undefined ? '' : answer);
  });
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
  await page.locator('#exportBtn').click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = fs.readFileSync(path);
  expect(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))).toBeTruthy();
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  expect(width).toBe(1200);
  expect(height).toBe(900);
  const centerPixel = await page.evaluate(async base64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + base64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data];
  }, bytes.toString('base64'));
  expect(centerPixel[0]).toBeGreaterThan(220);
  expect(centerPixel[1]).toBeGreaterThan(170);
  expect(centerPixel[2]).toBeGreaterThan(70);
  expect(errors, 'uncaught bounded export errors').toEqual([]);
});


test('photo library recovers when IndexedDB rejects Blob values', async ({ page }) => {
  test.setTimeout(45000);
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    let failBlobOnce = true;
    IDBObjectStore.prototype.put = function(value, ...args) {
      if (failBlobOnce && this.name === 'photos' && value && value.blob instanceof Blob) {
        failBlobOnce = false;
        throw new DOMException('Simulated Blob persistence failure', 'DataCloneError');
      }
      return originalPut.call(this, value, ...args);
    };
  });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 96; c.height = 72;
    const x = c.getContext('2d'); x.fillStyle = '#6483a1'; x.fillRect(0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  });
  await page.locator('#fileInput').setInputFiles({
    name: 'luma-blob-fallback.png', mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
  });
  await expect.poll(() => page.locator('#filename').innerText()).toContain('luma-blob-fallback.png');
  await page.locator('[data-tool="library"]').click();
  await page.locator('#saveToLibrary').click();
  await expect(page.locator('#libraryItems .library-row')).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator('#libraryItems .library-row')).toContainText('luma-blob-fallback.png');
  expect(errors, 'uncaught Blob fallback errors').toEqual([]);
});


test('mobile adjustment subcategory rail stays visible and switches panels without overlay', async ({ page }) => {
  test.setTimeout(30000);
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-tool="adjust"]').click();
  const rail = page.locator('[data-tool-panel="adjust"] .panel-subnav').first();
  await expect(rail).toBeVisible();
  const tabs = rail.locator('button');
  expect(await tabs.count()).toBeGreaterThanOrEqual(4);
  const first = tabs.nth(0);
  const second = tabs.nth(1);
  await first.click();
  await expect(first).toHaveClass(/active/);
  await second.click();
  await expect(second).toHaveClass(/active/);
  const box = await page.locator('#preview').boundingBox();
  const panelBox = await page.locator('[data-tool-panel="adjust"]').boundingBox();
  expect(box).toBeTruthy();
  expect(panelBox).toBeTruthy();
  expect(errors, 'mobile adjustment navigation errors').toEqual([]);
});


test('preview rendering is bounded and responds to adjustment and rotation changes', async ({ page }) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1800;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, c.width, c.height);
    g.addColorStop(0, '#174c88'); g.addColorStop(.5, '#e5b66b'); g.addColorStop(1, '#2f7048');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#f3d0b7'; x.beginPath(); x.arc(1200, 650, 260, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#20252c'; x.fillRect(900, 900, 600, 650);
    return c.toDataURL('image/png');
  });
  await page.locator('#fileInput').setInputFiles({
    name: 'luma-performance-test.png', mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
  });
  await expect.poll(() => page.locator('#preview').evaluate(c => c.width)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('#filename').innerText()).toContain('luma-performance-test.png');
  const dims = await page.locator('#preview').evaluate(c => [c.width, c.height]);
  expect(Math.max(...dims)).toBeLessThanOrEqual(640);

  await page.locator('[data-tool="adjust"]').click();
  const before = await page.locator('#preview').evaluate(c => [...c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data]);
  const startAdjust = Date.now();
  await page.locator('#exposureRange').evaluate(el => {
    el.value = '35'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => page.locator('#preview').evaluate(c => [...c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data]), { timeout: 5000 }).not.toEqual(before);
  const adjustMs = Date.now() - startAdjust;
  console.log('[PERF] mobile exposure preview updated in ' + adjustMs + 'ms');
  expect(adjustMs).toBeLessThan(3500);

  await page.locator('[data-tool="crop"]').click();
  const beforeRotate = await page.locator('#preview').evaluate(c => [c.width, c.height]);
  const startRotate = Date.now();
  await page.locator('#angleRange').evaluate(el => {
    el.value = '15'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => page.locator('#preview').evaluate(c => [c.width, c.height]), { timeout: 5000 }).not.toEqual(beforeRotate);
  const rotateMs = Date.now() - startRotate;
  console.log('[PERF] mobile rotation preview updated in ' + rotateMs + 'ms');
  expect(rotateMs).toBeLessThan(3500);
  expect(errors, 'preview performance regression browser errors').toEqual([]);
});


test('photo library actions are grouped into collapsible task sections', async ({ page }) => {
  test.setTimeout(30000);
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-tool="library"]').click();
  const groups = page.locator('#libraryActionGroups');
  await expect(groups).toBeVisible();
  await expect(groups.locator('details').nth(0)).toHaveAttribute('open', '');
  await expect(groups.locator('details').nth(1)).toHaveAttribute('open', '');
  await expect(groups.locator('details').nth(2)).not.toHaveAttribute('open', '');
  await groups.locator('summary').filter({ hasText: '백업 · 복원' }).click();
  await expect(page.locator('#backupFullLibrary')).toBeVisible();
  await groups.locator('summary').filter({ hasText: '백업 · 복원' }).click();
  await expect(page.locator('#backupFullLibrary')).not.toBeVisible();
  const settings = page.locator('#batchExportSettings');
  await expect(settings).toHaveAttribute('open', '');
  await settings.locator('summary').click();
  await expect(page.locator('#batchFormat')).not.toBeVisible();
  await settings.locator('summary').click();
  await expect(page.locator('#batchFormat')).toBeVisible();
  expect(errors, 'library action group browser errors').toEqual([]);
});
