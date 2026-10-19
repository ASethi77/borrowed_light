# Changelog

## 0.0.15

- Add support for ultra-high-resolution images (up to 512 megapixels)
  - Adds a custom WASM image loader for Linux to support portable image decoding
    across all distros. Windows and Mac use native OS APIs.
  - Adds profiling tools and CI reports to ensure performance. An 8k resolution
    wallpaper takes < 1s to process on my budget laptop.

## 0.0.14

- Documentation updates.

## 0.0.13

- Add icon + demo videos to the welcome page.

## 0.0.12

- Follow desktop light/dark appearance by default.
- Preserve explicit appearance preferences when accepting color previews; preview light/dark switches are temporary.
- Scope primary hue selections to the current wallpaper and reset both appearances to automatic after a new wallpaper successfully syncs.
- Retain hue tweaks for the same wallpaper across syncs/restarts and remember newly accepted preview choices.

## 0.0.11

- Add Command Palette toggles for automatic wallpaper sync and following desktop light/dark appearance.
- Show the new setting state after toggling; disabling desktop following keeps the currently visible light/dark appearance.
- Keep both toggles independent and retain border/syntax preferences.

## 0.0.10

- Add an independent Mellow/Balanced/Vibrant border contrast control to the preview toolbar.
- Save border preferences on preview acceptance and retain them across wallpaper syncs, color rules, light/dark modes, and syntax changes.
- Restore borders and preferences on Escape or dismissal; keep keyboard focus and control indicators visible.
- Default to Vibrant to preserve the previous border appearance until a new preference is accepted.

## 0.0.9

- Resolve modern macOS wallpaper selections from the local wallpaper store instead of using stale DefaultDesktop images.
- Use the selected aerial wallpaper's local preview for palette extraction, including Sequoia Sunrise.
- Watch macOS wallpaper changes and check desktop light/dark appearance every five seconds.
- Normalize macOS images to thumbnails with the built-in sips utility, allowing large HEIC/JPEG sources without loading them into the palette worker.

## 0.0.8

- Use Borrowed Light branding throughout the extension UI and documentation.
- Use `borrowed-light-local.borrowed-light` as the extension ID and `borrowed-light.*` for commands and settings.

## 0.0.7

- Recognize HTML documents in ordinary and raw Python triple-quoted strings, including embedded JavaScript and CSS.
- Preserve ordinary Python string highlighting and resume Python highlighting at the matching quote delimiter.

## 0.0.6

- Prevent green-only wallpapers from collapsing all vibrant syntax families into one hue.
- Supplement observed and harmony colors with separated derived accents, preserving neutral wallpapers.
- Increase vibrant chroma and distinguish Python call names and string/number storage scopes.
- Verify actual Python grammar scopes and the screenshot's green-only palette in light/dark modes.

## 0.0.5

- Cycle Mellow, Balanced, Vibrant, and Vibrant Alternate syntax styles in live previews.
- Use separated wallpaper highlights for vibrant syntax, including variables, parameters, and properties.
- Persist syntax style on Enter and restore it on Escape, with contrast checks for both token systems.
- Include the syntax style in the palette/contrast report.

## 0.0.4

- Start previews from the active Borrowed Light light/dark theme, preserving its appearance while cycling rules even when the saved preference differs.

## 0.0.3

- Cycle primary surface/accent colors from extracted wallpaper swatches and the selected harmony.
- Remember independent primary colors for light and dark modes.
- Generate and cache primary previews without decoding the wallpaper again.
- Show the selected primary source and hex value in the picker and contrast report.

## 0.0.2

- Light-theme surfaces respond to wallpaper brightness, colorfulness, and hue.
- Status-bar color-scheme picker previews six rules and light/dark in the actual workbench.
- Enter saves the selection; Escape restores the starting theme, with interrupted-preview recovery.
- One extraction prepares all twelve preview variants in the worker.

## 0.0.1

- Fedora/GNOME wallpaper discovery with light/dark wallpaper selection.
- Portable JPEG/PNG extraction and six documented harmony recipes.
- Complete light/dark workbench, syntax, semantic-token, and default terminal themes.
- Role-based contrast adjustment and a read-only palette/contrast report.
- Opt-in wallpaper monitoring, cancellation, and restart-safe theme restoration.
- Platform provider and future contrast-policy extension points.
