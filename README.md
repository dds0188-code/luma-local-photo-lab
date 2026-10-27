# Luma Local Photo Lab

A local-first photo editor for desktop and mobile browsers, with a Korean-language editing interface.

## Current capabilities

- Non-destructive editing and export to a new file
- Presets, favorites, custom preset backup, and supported XMP preset import
- Tone controls, HSL mixer, tone curves, color grading, and histogram
- Crop/rotate/zoom controls, undo/redo, and original-image comparison
- Brush/shape/gradient masks, local adjustments, relighting, and AI-assisted selection tools
- Browser-based photo library, metadata tools, and batch export utilities
- Responsive mobile workspace and desktop resizable controls panel
- Offline app shell through a service worker; AI-assisted tools may require connectivity

## Build and checks

Requires Node.js 22 or newer.

```sh
npm run test:syntax
npm run test:build
```

`test:syntax` checks JavaScript syntax, duplicate static IDs, UI element references, and key feature wiring. `test:build` builds `dist/` and verifies production assets, manifest fields, service-worker shell entries, version consistency, local asset references, and inline script syntax.

These automated checks are static/build checks; they do not replace real-device interaction tests for cropping, AI selection, masks, lighting, and export.

## Privacy and costs

The app is local-first and does not require a paid API for ordinary local editing. Do not commit original photos or private data to this repository.

## Deployment

GitHub Pages deployment is configured in `.github/workflows/deploy-pages.yml`. Pushes to `main` attempt a production build and deployment; check the repository Actions tab for the actual run result.
