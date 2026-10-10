# Changelog

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
