# Wallpaper Paste

Generate a readable VS Code theme from your Fedora/GNOME desktop wallpaper. The extension themes the workbench, TextMate syntax, semantic tokens, and terminal's default palette. It reads the wallpaper locally and does not upload images.

## Use

1. Install the VSIX through **Extensions: Install from VSIX…**, or open this directory in VS Code and press **F5**.
2. Run **Wallpaper Paste: Sync Theme from Wallpaper** from the Command Palette.
   Click **Wallpaper** in the status bar, or run **Wallpaper Paste: Preview Color Schemes**, to explore alternatives. Use ↑/↓ to preview any of the six rules, the toolbar arrows to cycle, and the color-mode button to toggle light/dark. The **symbol-color** button cycles the primary color; the adjacent left arrow cycles it backwards. The title shows its source and hex value. Light and dark previews remember separate primary choices. The picker starts in the currently selected Wallpaper Paste Light/Dark theme, even when the saved appearance preference differs. Changing rules or primary colors keeps that mode until you explicitly toggle it. The editor, syntax, and workbench update while the picker stays open. **Enter** keeps the selection and saves its rule/appearance; **Escape** or clicking outside restores the starting theme. Keeping an explicit light/dark preview replaces the `desktop` appearance setting.
3. Run **Wallpaper Paste: Show Palette and Contrast Report** to inspect the wallpaper's colors, generated harmony, readability adjustments, and contrast measurements. This command does not apply a theme.
4. Optionally enable `wallpaper-paste.autoSync` in Settings. Monitoring applies changes while a Wallpaper Paste theme is selected. Choosing another theme pauses application.
5. Run **Wallpaper Paste: Restore Previous Theme** to turn off auto-sync and restore settings from before the first sync. Later user edits are preserved.

The default is a dark analogous theme. Generated colors are stored in theme-specific blocks in your **user settings**, so unrelated themes and customization blocks remain intact. Explicit sync overwrites generated keys in those blocks. Restoration removes only values still matching the extension's last writes. Disable or uninstall alone leaves the applied settings in place; run Restore first if you want them removed. Generated user settings can travel through VS Code Settings Sync; wallpaper paths and the restoration ledger stay in local extension state and are not added to its synced keys.

## Requirements and limitations

- VS Code 1.128 or later; a local GNOME session with `gsettings` and the GNOME desktop schemas available.
- Local JPEG or PNG wallpaper, at most 64 MiB and 32 megapixels. Decoding/extraction runs in a separate worker with a 15-second deadline; the JPEG decoder has a 512 MiB allocation budget.
- Remote SSH, WSL, and Dev Container workspaces use the **local client** extension host and wallpaper. VS Code for the Web is unsupported.
- Flatpak or another sandbox may prevent access to the desktop settings or wallpaper file. Failures retain the last working theme; see the **Wallpaper Paste** Output channel.
- V1 reads the configured wallpaper image, not a screen capture. It does not reproduce monitor cropping, desktop overlays, per-monitor composition, or live wallpaper transitions.
- WebP, SVG, JXL, GNOME XML slideshows, and Windows/macOS/other Linux desktop discovery are not supported yet. A missing/unreadable image reports an error rather than replacing your current theme.
- Images are interpreted as sRGB; embedded ICC profiles are not color-managed. Fully transparent pixels are ignored, and partial transparency weights palette samples without reconstructing the desktop background composite.

## Settings

| Setting | Default | Options |
| --- | --- | --- |
| `wallpaper-paste.harmony` | `analogous` | `analogous`, `monochromatic`, `triad`, `complementary`, `compound`, `shades` |
| `wallpaper-paste.appearance` | `dark` | `dark`, `light`, `desktop` |
| `wallpaper-paste.primaryDark` | `automatic` | `automatic`, `wallpaper-1`…`wallpaper-8`, `harmony-1`…`harmony-5` |
| `wallpaper-paste.primaryLight` | `automatic` | Same options, remembered independently for light mode |
| `wallpaper-paste.autoSync` | `false` | Enable wallpaper/appearance monitoring and periodic file checks |

Settings apply at application scope. With auto-sync off, change settings and run Sync again to apply them. With auto-sync on, changes regenerate the selected Wallpaper Paste theme. Monitoring uses GNOME change notifications plus a check every 30 seconds for file changes, including replacement at the same path. Source changes are debounced for 500 ms; superseded workers are cancelled.

GNOME's appearance selects the wallpaper URI: `picture-uri-dark` for dark appearance, otherwise `picture-uri`. An empty/missing dark key falls back to the ordinary URI. This selection follows the desktop even when VS Code's generated appearance is explicitly dark or light.

## Color recipes

A deterministic, opacity-weighted median-cut quantizer extracts up to eight representative colors from a bounded image sample. The most populous non-neutral swatch seeds the harmony; grayscale wallpapers retain a neutral palette. Harmony colors may be derived rather than present in the source image.

Recipes use OKLCH hue angles and lightness/chroma. Out-of-gamut colors reduce chroma to fit sRGB. These are documented implementations of common harmony concepts, not promises to reproduce a particular commercial color tool's color wheel.

| Recipe | Construction |
| --- | --- |
| Analogous | Seed hue and neighbors at ±30° and ±60° |
| Monochromatic | One hue with five lightness/chroma combinations |
| Triad | Seed hue, +120°, +240°, and two tonal variants |
| Complementary | Seed hue, its +180° complement, and tonal variants |
| Compound | Seed hue, ±30° neighbors, and +150°/+210° split complements |
| Shades | Seed hue/chroma with descending lightness |

Light themes use the wallpaper's weighted brightness and colorfulness to set surface lightness and tint, so colorful wallpapers produce visible differences in the editor, sidebar, and fields. Grayscale wallpapers remain neutral. The preview prepares all twelve rule/appearance combinations in a worker after one extraction; cycling reuses these results without decoding the image again. Automatic syncing waits while the picker is open. Interrupted previews are restored when the extension next activates.

Primary colors include both extracted wallpaper swatches (ordered by their image coverage) and colors derived by the selected harmony. This allows smaller blue, yellow, or red highlights to drive the surfaces and accents even when the dominant background is green. Syntax still uses the selected harmony, with contrast adjustments recalculated for the chosen surfaces. Preferences store source slots rather than fixed hex values: they adapt to new wallpapers and rules, and a missing wallpaper slot falls back to automatic. New primary previews are generated in the worker from the existing swatches and cached for the session. Enter saves both modes' choices; Escape discards them.

## Readability and the report

The balanced policy requires a WCAG contrast ratio of at least **4.5:1** for generated primary text, comments, secondary text, syntax categories, button labels, and input text against the controlled surfaces. Essential focus indicators target **3:1**. Readability is checked again on final 8-bit sRGB hex values after adjustment. Comments remain less prominent where possible while meeting the text minimum.

The report includes pairwise matrices for extracted swatches and harmony colors, the original/adjusted color for each semantic role, and foreground/background checks. Arbitrary palette pairs have no universal pass/fail threshold: a pair only needs to meet a readability target when assigned a corresponding role. Known global/workspace customization conflicts are reported where detectable.

These checks cover generated theme roles, not every rendered pixel in VS Code. Language-specific settings, additional token scopes, third-party webviews, transparency, terminal applications selecting their own foreground/background combinations, and user overrides can change actual contrast. Diagnostic error/warning/success colors and terminal status hues preserve recognizable meanings rather than strictly following the selected harmony.

## Development

```sh
npm ci
npm run test:unit
npm run test:host
npm run package
npm run vsix
```

Host tests launch an isolated VS Code profile. The test runner downloads VS Code by default. To use an installed copy:

```sh
VSCODE_EXECUTABLE_PATH=/path/to/code npm run test:host
# Headless Linux:
xvfb-run -a env VSCODE_EXECUTABLE_PATH=/path/to/code npm run test:host
```

Run the unit suite before host tests to compile test files. `npm test` runs both. `npm run vsix` produces `wallpaper-paste-0.0.4.vsix`; both themes and the bundled worker are included. The publisher `wallpaper-paste-local` is a local packaging placeholder and must be replaced with your registered publisher before Marketplace publication. This project has not selected a distribution license; the local packaging command skips that prompt. Bundled dependency licenses are reproduced in `THIRD_PARTY_NOTICES.md`.

## Extension points

- `WallpaperProvider` and `providerRegistry` isolate desktop detection, current-image resolution, and optional notifications. Add Windows, macOS, or another Linux desktop provider without modifying the color pipeline.
- JPEG/PNG decoding is isolated in the worker; extend decoding without introducing OS-specific extraction logic.
- Extraction, harmony generation, semantic-role assignment, contrast policy, and VS Code application are independent stages.
- `ContrastPolicy` contains per-role targets. Only `balanced` is exposed in v1. A future high-contrast or focused policy can change secondary/comment emphasis while preserving primary text requirements.
- Generated theme ownership is journaled before configuration writes, enabling restoration across restarts and rollback of a failed application.

To smoke-test manually, try light and dark appearances with colorful and grayscale JPEG/PNG files, inspect TypeScript/Python/Markdown syntax, and check the sidebar, status bar, terminal, notifications, buttons, fields, and selected text. Then change the wallpaper, edit a generated color, select another theme, and verify pause/restoration behavior.
