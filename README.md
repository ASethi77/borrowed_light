# Borrowed Light

Turn your wallpaper into a VS Code theme. Automatically syncs wallpaper colors and system light/dark mode changes
to create a theme fhat fits your desktop perfectly. No external softtware is required, and your wallpapers are never
uploaded anywhere.

[![CI](https://github.com/ASethi77/borrowed_light/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/ASethi77/borrowed_light/actions/workflows/ci.yml)



https://github.com/user-attachments/assets/bc38d629-6a72-4620-b992-29f1d968931e



> **Automatically generate light and dark themes from the same wallpaper.** Preview both appearances, choose a primary hue for each, and keep your preferred theme.

**No external software needs to be installed on supported desktops.** Borrowed Light includes JPEG/PNG decoding and uses built-in OS capabilities for wallpaper discovery and additional native image formats.

## Supported platforms

| Operating system | Desktop environment                           | Status                               |
| ---------------- | --------------------------------------------- | ------------------------------------ |
| Windows          | Windows desktop                               | Supported                            |
| macOS            | macOS desktop                                 | Supported                            |
| Fedora Linux     | GNOME                                         | Supported                            |
| Ubuntu Linux     | GNOME                                         | Supported                            |
| Linux (Generic)  | GNOME                                         | Unsupported, but should work with GNOME |
| Linux (Generic)  | KDE, Xfce, Cinnamon, MATE, and other desktops | Unsupported       |

Use VS Code **1.128 or later** with a local wallpaper. All platforms support JPEG/PNG sources up to **256 megapixels by default**, configurable to **512 MP** with `borrowed-light.maxImageMegapixels` (also limited to 2 GiB and 65,500 pixels per edge). Linux includes a portable decoder; no image packages need to be installed. See [image-processing bounds](ARCHITECTURE.md#image-processing-bounds) for details.

## Get started

Install the extension from the [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=asethi77.borrowed-light):

> ext install asethi77.borrowed-light

The extension will activate its color theme and begin syncing to your desktop settings as soon as you install.

You can change back to another theme or toggle wallpaper and/or light/dark mode syncs at anytime. The setup guide with **Borrowed Light: Show Welcome** walks through the available options.

> **Tip**: In the Command Palette, type `borrowed-light` to see all available commands.

## Make it your own

The preview updates your actual editor and workbench as you make changes.

| Preview control | What it changes |
| --- | --- |
| ↑/↓ or the rule arrows | Analogous, Monochromatic, Triad, Complementary, Compound, or Shades |
| Light/dark button | Temporary preview appearance; keeps your saved light/dark/desktop preference |
| Primary color buttons | The main hue, cycling through wallpaper and color-rule choices; light and dark remember separate choices for the current wallpaper |
| Border button (panel icon) | Mellow, Balanced, or Vibrant pane-border contrast, independent of syntax colors |
| Syntax button (keyword icon) | Mellow, Balanced, Vibrant, or Vibrant Alternate highlighting |
| **Enter** | Keep the preview and save your choices |
| **Escape** or click outside | Return to your starting theme |

## Demos

| Demo | Preview |
| --- | --- |
| Syncing with a new wallpaper | https://github.com/user-attachments/assets/760ff19d-294c-486d-b2a3-bcfa9a960502 |
| Changing the primary hue and color rule | https://github.com/user-attachments/assets/e890a531-f6fe-46c0-a513-e36a5176efbf |
| Changing syntax highlighting | https://github.com/user-attachments/assets/aef11db3-2903-4686-9f97-29ba08b4f5a9  |

<!-- TODO: Replace each demo placeholder with its recorded video. -->

## Readability and restoring your theme

Generated text colors are adjusted for readability. Run **Borrowed Light: Show Palette and Contrast Report** to inspect the colors and contrast checks if something looks off. User customizations and other extensions can affect the result.

Run **Borrowed Light: Restore Previous Theme** to disable both wallpaper and system appearance syncing and restore your earlier theme settings. Later manual edits are preserved where they differ from the generated values. Run Restore before uninstalling if you want the generated settings removed; disabling or uninstalling alone leaves the applied theme settings in place.

If sync fails, your last working theme stays in place. Open the **Borrowed Light** Output channel for details.

## Further reading

[Architecture and color theory](ARCHITECTURE.md) · [Building, running, and testing](DEVELOPING.md)
