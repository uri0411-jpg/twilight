# Twilight — GitHub-ready PWA

This package preserves the existing forecast / sun / favorites / notifications / spot-finder logic and adds a sunset-themed visual redesign.

## Structure
- `index.html` — forecast home screen
- `spot.html` — sunset spot finder
- `css/app.css` — original styling + redesign overrides
- `js/` — original app logic
- `assets/` — generated hero backgrounds and spot artwork
- `icons/` — app icons
- `.well-known/assetlinks.json` — Android app links/TWA support

## Deploy on GitHub Pages
1. Upload the contents of this folder to the repository root.
2. Enable GitHub Pages from the main branch / root.
3. Make sure the site is served from `/twilight/` if your repo name is `twilight`.
4. After updating files, do a hard refresh once so the new service worker cache is used.

## Notes
- Data APIs still require network access.
- Offline mode covers shell pages and local assets.
- Spot Finder still uses Leaflet + OpenStreetMap + OSRM routing.
