# Luma Local Photo Lab

A local-first photo editor for desktop and mobile browsers.

## Project status

Early prototype. Original images are not overwritten; edits are applied in the browser and exported as a new image.

## Roadmap

- Responsive desktop and mobile layout; individual control reset
- Non-destructive recipes, presets, undo/redo, and reliable export
- HSL, RGB tone curves, and color grading
- Brush and gradient masks with local adjustments
- Photo library, metadata, batch editing, and broader format support
- Automated acceptance tests and performance checks

## Privacy and costs

The current prototype is browser-based and does not require a paid API. Do not commit original photos to this repository.

## Deployment

GitHub Pages deployment configuration will be added after the application source is uploaded.

## Deployment status

GitHub Pages deployment workflow is configured via `.github/workflows/deploy-pages.yml`. Every push to `main` attempts to deploy the current site.
