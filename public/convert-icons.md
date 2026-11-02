# Cloudpit icons

The favicon, logo and PWA icons are generated from one committed raster source:

- `public/logo-source.png` — glossy blue airfoil canopy on navy (1254×1254, raster only).

Regenerate the whole set from the repo root:

```bash
node public/generate-icons.js                 # favicon, logo, PWA icons
node electron/scripts/generate-macos-icon.js  # logo-macos.png + .icns
node electron/scripts/generate-windows-icon.js# logo-windows.ico
```

The wide airfoil is used at full width with a centered navy field; maskable icon
consumers accept the tip crop. There is no vector source yet, so `favicon.svg` and
`logo.svg` are thin wrappers that embed a raster PNG.
