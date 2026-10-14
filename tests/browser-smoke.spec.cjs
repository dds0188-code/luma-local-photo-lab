const { test, expect } = require('@playwright/test');
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
  expect(await page.evaluate(() => activeMask().shapes.length)).toBe(2);
  await page.locator('#maskShapeEdit').click();
  await page.mouse.click(box.x + box.width * .36, box.y + box.height * .40);
  const firstX = Number(await page.locator('#maskShapeX').inputValue());
  await page.mouse.click(box.x + box.width * .68, box.y + box.height * .40);
  const secondX = Number(await page.locator('#maskShapeX').inputValue());
  expect(Math.abs(firstX - secondX)).toBeGreaterThan(15);
  await expect(page.locator('#maskOverlayToggle')).toContainText('숨기기');
  await page.locator('#maskOverlayToggle').click();
  await expect(page.locator('#maskOverlayToggle')).toContainText('표시');
  await page.locator('[data-mask-view="layers"]').click();
  await page.locator('#maskSplit2H').click();
  const splitState = await page.evaluate(() => ({
    count: maskLayers.length,
    masks: maskLayers.map(l => {
      const d = l.canvas.getContext('2d').getImageData(0, 0, l.canvas.width, l.canvas.height).data;
      let pixels = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) pixels++;
      return { hasData: l.hasData, pixels };
    })
  }));
  expect(splitState.count).toBe(2);
  expect(splitState.masks.every(m => m.hasData && m.pixels > 0)).toBeTruthy();
  await expect(page.locator('#maskSplitAdjust')).toBeVisible();
  await page.locator('#maskSplitBoundary1').fill('62');
  await expect.poll(() => page.evaluate(() => Math.round(maskLayers.find(l => l.clipRegion)?.clipRegion?.h * 100))).toBe(62);
  const looks = await page.evaluate(() => presetData.map(p => JSON.stringify({
    exposure:p.settings.exposure, temperature:p.settings.temperature, tint:p.settings.tint,
    saturation:p.settings.saturation, vibrance:p.settings.vibrance, fade:p.settings.fade,
    hslOrange:p.settings.hsl_orange_sat, hslGreen:p.settings.hsl_green_sat
  })));
  expect(new Set(looks).size).toBeGreaterThanOrEqual(25);
  expect(pageErrors, 'uncaught mask workflow errors').toEqual([]);
});
