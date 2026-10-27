const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const fail = message => { throw new Error("[build-check] " + message); };
const exists = file => fs.existsSync(path.join(dist, file));
const required = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "icons/luma-icon.svg",
  "icons/luma-icon-maskable.svg",
];
for (const file of required) {
  if (!exists(file)) fail("Required production asset missing: " + file);
  const stat = fs.statSync(path.join(dist, file));
  if (!stat.isFile() || stat.size === 0) fail("Required production asset is empty: " + file);
}

const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.webmanifest"), "utf8"));
const sw = fs.readFileSync(path.join(dist, "sw.js"), "utf8");
const version = html.match(/<meta name="luma-app-version" content="([^"]+)">/);
if (!version || version[1] !== pkg.version) {
  fail("Built app version does not match package.json (" + pkg.version + ")");
}
if (!manifest.name || !manifest.start_url || !manifest.display) {
  fail("Web manifest is missing name, start_url, or display");
}
if (!/const CACHE_NAME = "luma-shell-v\d+"/.test(sw)) {
  fail("Service worker cache version is missing");
}
for (const file of required.slice(1)) {
  if (!sw.includes("./" + file)) fail("Service worker app shell does not include ./" + file);
}

// Validate relative file references in the shipped HTML. Ignore data URLs, anchors,
// remote URLs, and dynamic JavaScript strings; check actual static href/src attributes.
const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map(match => match[1]);
for (const ref of refs) {
  if (/^(?:https?:|data:|blob:|#|\/\/)/i.test(ref)) continue;
  const clean = decodeURIComponent(ref.split(/[?#]/, 1)[0]);
  if (!clean) continue;
  const resolved = path.resolve(dist, clean);
  if (!resolved.startsWith(dist + path.sep) && resolved !== dist) fail("Unsafe asset path: " + ref);
  if (!fs.existsSync(resolved)) fail("Broken local asset reference: " + ref);
}

// Check all shipped inline scripts again after the production build transform.
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
if (!scripts.length) fail("No application scripts found in production HTML");
scripts.forEach((match, index) => {
  if (!match[1].trim()) return;
  try { new Function(match[1]); }
  catch (error) { fail("Production inline script " + (index + 1) + " has invalid syntax: " + error.message); }
});

console.log("[build-check] Production assets, manifest, service-worker shell, version, local links, and inline scripts passed.");
