# Marbles Cam

A PWA for iPhone that produces Juicy Marbles style photographs: shot in the dark with hard on-axis light, black falloff, sharp, saturated. No backend, no accounts, no analytics. Static files on HTTPS.

Live at: https://lsinstra.github.io/Claude/marbles-cam/

## Status: M1

Shipped in this milestone:

- PWA shell: installable, standalone, portrait, offline after first load
- Mode B, native flash: "Shoot with flash" opens the native camera through a file input. First use per session shows the checklist (flash on, night mode off, lights off, 40 to 80 cm)
- EXIF check with exifr: flash fired flag, ISO, shutter, aperture shown on review. "No flash detected" warning when the flash did not fire
- Import: single image from Photos through the picker
- Look Engine: WebGL2, four passes, deterministic. White balance, centre-weighted auto exposure toward target luma, S-curve tone with black and white points, highlight recovery, inverse-square falloff centred on the subject point, vibrance plus saturation plus red-orange band boost, unsharp mask, monochrome grain. CPU fallback (reduced look) when WebGL2 is missing
- Review: Look and Raw toggle, tap the image to move the falloff centre, live reprocess
- Export: full 4096, web 2048, square 1080 (subject-centred 1:1 crop). Share sheet with Save Image, download fallback. Filename `JM_YYYYMMDD_HHMMSS_preset.jpg`. Canvas re-encode strips all EXIF including location

Not yet in M1 (per the brief's milestones): Mode A live torch viewfinder (M2), library and batch import and preset switching in the UI (M3), tuning screen with reference comparison and histograms (M4). The `harder` and `print` preset JSONs are already in `/presets` for M3.

## Known deviations from the brief

- Stack: this repo deploys to GitHub Pages straight from the main branch root with no build step, so the app is buildless ES modules instead of Vite plus TypeScript, and exifr is vendored in `/vendor`. Same behaviour, zero toolchain. Happy to move to Vite plus Cloudflare Pages when the repo grows a CI step
- EXIF date is used for the filename but is not re-embedded into the exported JPEG (canvas re-encode strips everything). Location is therefore always stripped, which the brief wants; keeping the date tag inside the file needs a small EXIF writer and is queued for M2
- Splash screen is shipped for the iPhone 16 Pro viewport only

## Phone setup (do this once)

1. Settings, Camera, Formats: Most Compatible. Resolution 24 MP or 48 MP
2. Settings, Camera, Preserve Settings: Exposure Adjustment on, Camera Mode on. Live Photo off
3. Camera app: flash On, not Auto. Exposure -0.3 to -0.7 EV. Macro auto off
4. Photographic Style "JM": Tone -0.6 to -1.0, Color +0.3, Palette Standard or Vibrant
5. Optional Shortcut "JM Shot": Take Photo, back camera, flash On, no preview, save to album JM Raw. Import from that album with the Import button

## Development

No build. Serve the folder over HTTPS (camera and share APIs need a secure origin):

    npx http-server marbles-cam -p 8080

For on-phone testing against a laptop, use mkcert for a LAN certificate, or push to a branch and use any static host.

Presets live in `/presets` as JSON and are precached by the service worker. Bump the `CACHE` constant in `sw.js` when shipping changes.

## Reference images

Drop 10 to 20 Juicy Marbles photographs into `/reference` for the M4 tuning screen. The folder is gitignored except for its README.
