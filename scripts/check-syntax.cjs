const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
if (!scripts.length) throw new Error("No inline application scripts found");

// Check static HTML IDs separately from JavaScript templates, where repeated template
// placeholders (for example id="area-") are not actual duplicate DOM IDs.
const staticMarkup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const staticIds = [...staticMarkup.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicateIds = [...new Set(staticIds.filter((id, index) => staticIds.indexOf(id) !== index))];
if (duplicateIds.length) throw new Error("Duplicate static HTML IDs: " + duplicateIds.join(", "));

scripts.forEach((match, index) => {
  if (match[1].trim()) {
    try { new Function(match[1]); }
    catch (error) { throw new Error("Inline script " + (index + 1) + ": " + error.message); }
  }
});
for (const file of ["desktop/main.cjs", "scripts/build-web.cjs", "sw.js"]) {
  new Function(fs.readFileSync(file, "utf8"));
}
for (const file of ["package.json", "capacitor.config.json", "manifest.webmanifest"]) {
  JSON.parse(fs.readFileSync(file, "utf8"));
}
// Guard the regressions repeatedly reported during mobile editing reviews.
// These checks verify the required wiring exists; they do not replace real-device testing.
const requiredMarkers = [
  ["fixed mobile photo preview", "--mobile-preview-h:clamp(160px,25dvh,210px)"],
  ["independently scrolling mobile controls", "-webkit-overflow-scrolling:touch;touch-action:pan-y"],
  ["horizontal mobile submenu rails", "overscroll-behavior-x:contain;scrollbar-width:none"],
  ["crop pointer-down handler", "cropOverlay.addEventListener('pointerdown'"],
  ["crop pointer-move handler", "cropOverlay.addEventListener('pointermove'"],
  ["relighting position overlay", "function drawRelightOverlay()"],
  ["AI smart-lasso implementation", "async function runAISmartLasso()"],
  ["AI lasso prompt-aware candidate scoring", "positiveAgreement*.35+negativeAgreement*.25"],
  ["AI lasso prompt coordinate mapping", "point[0]/Math.max(1,iw-1)*(maskW-1)"],
  ["AI area-lasso button binding", "querySelectorAll('[data-area-ai-lasso]')"],
  ["cached pattern-based cutout preview checkerboard", "ctx.createPattern(checkerboardTile,'repeat')"],
  ["checkerboard tile alignment", "tileCtx.fillRect(12,0,12,12);tileCtx.fillRect(0,12,12,12)"],
  ["direct mask-boundary rendering", "drawSelectionBoundary(maskCanvas,'rgba(217,243,107,.24)')"],
  ["bounded-resolution selection boundary", "const maxEdge=720,scale=Math.min(1,maxEdge/Math.max(o.width,o.height))"],
  ["downsampled mask edge tracing", "tc.getImageData(0,0,w,h).data"],
  ["bounded clipping-warning scan", "const maxEdge=720,scale=Math.min(1,maxEdge/Math.max(canvas.width,canvas.height))"],
  ["reused clipping-warning buffers", "clippingSampleCanvas||(clippingSampleCanvas=document.createElement('canvas'))"],
  ["relight row coordinate hoisting", "const relightY=activeRelightLayers.length?y/Math.max(1,h-1):0;for(let x=0;x<w;x++)"],
  ["single per-pixel relight X coordinate", "const relightX=activeRelightLayers.length?x/Math.max(1,w-1):0;for(const layer of activeRelightLayers)"],
  ["reused selection boundary canvas", "selectionBoundaryCanvas||(selectionBoundaryCanvas=document.createElement('canvas'))"],
  ["precomputed relight layer position", "_x:Number(layer.x||0)/100,_y:Number(layer.y||0)/100"],
  ["precomputed relight intensity", "_strength:Number(layer.intensity||0)/100*.85"],
  ["per-pixel relight coordinate reuse", "const relightX=activeRelightLayers.length?x/Math.max(1,w-1):0"],
  ["image loading pipeline", "function loadFile(file,savedRecipe=null)"],
  ["asynchronous image decode hint", "img.decoding='async';img.onload=async()=>"],
  ["non-destructive export pipeline", "function exportImage(type,quality=94,scale=100,options={})"],
  ["crop-aware output pipeline", "function cropProcessedCanvas(source)"],
  ["selectable crop composition guides", "cropGuideMode==='golden'?[.382,.618]"],
  ["crop guide is display-only", "구도선은 미리보기에만 표시되며 저장한 사진에는 포함되지 않습니다."],
  ["undo/redo wiring", "$('undo').onclick=()=>travelEditorHistory('undo')"],
  ["histogram rendering", "function updateHistogram(source)"],
  ["on-canvas color sampler", "function samplePreviewColor(event)"],
  ["sampler mode safely exits on tool switch", "if(name!=='color'&&samplerPicking)setSamplerMode(false)"],
  ["pinned color sample collection", "samplerSamples.length>=8"],
  ["5x5 average color extraction", "Math.max(0,x-2),y0=Math.max(0,y-2)"],
  ["HSL adjustment pipeline", "function applyHsl("],
  ["workspace-density preview resolution", "const cssEdge=Math.max(rect?.width||0,rect?.height||0,window.innerWidth*.72,window.innerHeight*.68)"],
  ["stable interactive render scheduling", "Expensive mask/HSL/curve pixel passes are coalesced; canvas resolution stays constant for the whole gesture."],
  ["full-quality render on slider release", "range.addEventListener('change',()=>{fastPreview=false;clearTimeout(fastPreviewTimer);scheduleRender(0,false);saveHistory()})"],
  ["high density preview cap", "mobile?(memory<=4?1500:1800):(memory<=4?1900:2400)"],
  ["color grading pipeline", "function applyColorGrade("],
  ["cinematic bloom and halation pipeline", "function applyOpticalGlow(target)"],
  ["bloom highlight extraction", "threshold=kind==='bloom'?.58:.72"],
  ["warm film halation blend", "dst[i]=255*mask;dst[i+1]=Math.round(92*mask);dst[i+2]=Math.round(38*mask)"],
  ["bounded optical effect processing", "maxEdge=1800,scale=Math.min(1,maxEdge/Math.max(w,h))"],
  ["lens distortion and chromatic aberration pipeline", "function applyLensCorrections(target)"],
  ["bounded lens correction processing", "maxEdge=2400,scale=Math.min(1,maxEdge/Math.max(w,h))"],
  ["lens controls in effects panel", "lensDistortion:'effects',chromaticAberration:'effects'"],
  ["seven-color HSL selector", "const palette=["],
  ["single active HSL group", "#hslControls .hslgroup[data-active=\"true\"]{display:block!important}"],
  ["visible seven-color HSL labels", "chip.textContent=item.label"],
  ["precomputed tone-curve lookup tables", "new Float32Array(4096)"],
  ["high-quality image resampling", "ctx.imageSmoothingQuality='high'"],
  ["consistent line icons for editing tools", "const paths={"],
  ["desktop canvas-first grid", "grid-template-columns:minmax(0,1fr) minmax(390px,var(--luma-right-width,430px))"],
  ["desktop panel resize bounds", "max: Math.min(620, Math.max(460, window.innerWidth * .42))"],
  ["effects controls in adjustment panel", "bloom:'effects',bloomRadius:'effects',halation:'effects',halationRadius:'effects'"],
  ["mask layer rendering", "function renderMaskLayer("],

  ["presets live in the right inspector", 'class="toolpane preset-workspace" data-tool-panel="presets"'],
  ["photo-aware preset thumbnails", "function getPresetThumbnail()"],
  ["preset-specific thumbnail rendering", "swatch.style.filter=presetThumbnailFilter(p)"],
  ["presets no longer trigger left-side workspace mode", "const side=name==='library';"],
  ["preset browsing and management are separated", 'class="preset-management"'],
  ["preset management does not auto-expand over the preset browser", "name==='presets')return;"],
  ["consistent preset panel grid", ".presets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))"],
  ["unified Luma Studio design system", 'id="luma-studio-design-v8"'],
  ["global tool navigation", 'id="luma-global-navigation-v8"'],
  ["export has a dedicated editing tool", 'data-tool-panel="export"'],
  ["project controls are separated from masking", 'class="project-management"'],
  ["mask panel no longer hosts export actions", 'data-mask-view="adjust"'],

  ["area select and adjustment views", 'data-area-view="adjust"'],












];
for (const [label, marker] of requiredMarkers) {
  if (!html.includes(marker)) throw new Error("Missing required editor wiring: " + label);
}

const desktopSource = fs.readFileSync("desktop/main.cjs", "utf8");
const desktopMarkers = [
  ["desktop permission denial", "setPermissionRequestHandler"],
  ["desktop permission checks denied", "setPermissionCheckHandler"],
  ["desktop navigation guard", "will-navigate"],
  ["desktop embedded webview guard", "will-attach-webview"],
  ["desktop context isolation", "contextIsolation: true"],
  ["desktop renderer sandbox", "sandbox: true"],
];
for (const [label, marker] of desktopMarkers) {
  if (!desktopSource.includes(marker)) throw new Error("Missing desktop security wiring: " + label);
}
const staticIdSet = new Set(staticIds);
const dynamicIdSet = new Set(["maskExposure", "maskSaturation"]);
const optionalIdSet = new Set(["togglePanelGroups"]);
const idBindingPattern = new RegExp("\\$\\(['\"]([^'\"]+)['\"]\\)", "g");
const directIdRefs = [...html.matchAll(idBindingPattern)].map(match => match[1]);
const missingBindings = [...new Set(directIdRefs)].filter(id =>
  !staticIdSet.has(id) && !dynamicIdSet.has(id) && !optionalIdSet.has(id)
);
if (missingBindings.length) {
  throw new Error("UI references missing DOM IDs: " + missingBindings.join(", "));
}
console.log("Luma syntax, static IDs, UI binding integrity, configuration, and editor regression-guard checks passed.");
