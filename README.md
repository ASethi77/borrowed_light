# Borrowed Light

[![CI](https://github.com/ASethi77/borrowed_light/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/ASethi77/borrowed_light/actions/workflows/ci.yml)

Turn your desktop wallpaper into a readable VS Code theme. Borrowed Light colors the editor, syntax highlighting, workbench, and terminal palette, with live previews to help you find a look you like. Your wallpaper stays on your computer; images are never uploaded.

https://github.com/user-attachments/assets/fe179015-0882-4238-bf53-313f00dd7f96

> **Automatically generate light and dark themes from the same wallpaper.** Preview both appearances, choose a primary hue for each, and keep your preferred theme.

**No external software needs to be installed on supported desktops.** Borrowed Light includes JPEG/PNG decoding and uses built-in OS capabilities for wallpaper discovery and additional native image formats.

## Supported platforms

| Operating system | Desktop environment | Status |
| --- | --- | --- |
| Fedora Linux | GNOME | Supported; current development and testing target |
| Other Linux distributions | GNOME | Uses the same provider; not yet validated |
| Linux | KDE Plasma | Not yet supported |
| Linux | Xfce, Cinnamon, MATE, and other desktops | Not yet supported |
| Windows | Windows desktop | Implemented; native desktop validation pending |
| macOS | macOS desktop | Implemented; native desktop validation pending |

Use VS Code **1.128 or later** with a local wallpaper, up to **64 MiB / 32 megapixels**. JPEG and PNG work on every supported desktop. Windows also uses native codecs for BMP; macOS uses native codecs for HEIC. Native normalization must also fit within 64 MiB. OS settings and built-in helpers must be accessible to VS Code; sandboxed installations or managed-device restrictions may prevent access.

Remote SSH, WSL, and Dev Container workspaces use your **local computer's wallpaper**. VS Code for the Web, live wallpapers, solid-color backgrounds, and GNOME XML slideshows are unsupported. Windows/macOS use the primary display's wallpaper; GNOME uses its configured wallpaper image. Multi-image files use the first still frame, which may differ from macOS's active dynamic wallpaper frame.

## Get started

1. Install a Borrowed Light VSIX using **Extensions: Install from VSIX…**. Successful [CI runs](https://github.com/ASethi77/borrowed_light/actions/workflows/ci.yml) provide a `borrowed-light-vsix` download containing the VSIX.
2. Open the Command Palette and run **Borrowed Light: Sync Theme from Wallpaper**.
3. Click **Borrowed Light** in the status bar, or run **Borrowed Light: Preview Color Schemes**, to explore alternatives.

The initial theme is dark with the Analogous color rule. In VS Code Settings, set `borrowed-light.appearance` to `light`, `dark`, or `desktop` to follow your desktop's appearance. Platform detection is automatic; `borrowed-light.platformProvider` lets you override it, for example selecting `linux-gnome` in an ambiguous Linux session. Overrides must match your OS.

## Make it your own

The preview updates your actual editor and workbench as you make changes.

| Preview control | What it changes |
| --- | --- |
| ↑/↓ or the rule arrows | Analogous, Monochromatic, Triad, Complementary, Compound, or Shades |
| Light/dark button | Theme appearance |
| Primary color buttons | The main hue, cycling through wallpaper and color-rule choices; light and dark remember separate choices |
| Syntax button (keyword icon) | Mellow, Balanced, Vibrant, or Vibrant Alternate highlighting |
| **Enter** | Keep the preview and save your choices |
| **Escape** or click outside | Return to your starting theme |

**Mellow** uses soft colors, **Balanced** adds moderate colorfulness, and **Vibrant** gives syntax categories more distinct colors. **Vibrant Alternate** changes which colors go to which categories. Syntax style is shared between light and dark themes.

Enable `borrowed-light.autoSync` in Settings to update when your wallpaper changes. Windows/macOS check for changes every 30 seconds; GNOME also listens for settings changes. Auto-sync is off by default and pauses when you select a different theme. With auto-sync off, run Sync again after changing the wallpaper or settings.

## Demos

| Demo | Preview |
| --- | --- |
| Syncing with a new wallpaper | _Video demo coming soon._ |
| Changing the primary hue and color rule | _Video demo coming soon._ |
| Changing syntax highlighting | _Video demo coming soon._ |

<!-- TODO: Replace each demo placeholder with its recorded video. -->

## Readability and restoring your theme

Generated text colors are adjusted for readability. Run **Borrowed Light: Show Palette and Contrast Report** to inspect the colors and contrast checks if something looks off. User customizations and other extensions can affect the result.

Run **Borrowed Light: Restore Previous Theme** to turn off auto-sync and restore your earlier theme settings. Later manual edits are preserved where they differ from the generated values. Run Restore before uninstalling if you want the generated settings removed; disabling or uninstalling alone leaves the applied theme settings in place.

If sync fails, your last working theme stays in place. Open the **Borrowed Light** Output channel for details.

## Further reading

[Architecture and color theory](ARCHITECTURE.md) · [Building, running, and testing](DEVELOPING.md)
