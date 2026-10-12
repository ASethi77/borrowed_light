# Architecture

Borrowed Light separates desktop wallpaper discovery from image processing, color generation, and VS Code configuration. The image and its extracted palette are processed locally.

## Code map

| Module | Responsibility |
| --- | --- |
| [src/extension.ts](src/extension.ts) | Commands, settings, sync scheduling, cancellation, and lifecycle |
| [src/model.ts](src/model.ts) | Provider contracts, palette/theme data, preferences, and contrast policy |
| [src/platform/os_detect.ts](src/platform/os_detect.ts), [src/platform/os_wallpaper.ts](src/platform/os_wallpaper.ts) | OS/desktop detection, provider override routing, and native decoder selection |
| [src/platform/](src/platform/) | Windows/macOS helpers and Linux desktop implementations, plus provider/decoder contracts |
| [src/image/](src/image/) | Portable file URIs, bounded file reads, JPEG/PNG decoding, and image limits |
| [src/pipeline.ts](src/pipeline.ts), [src/palette-worker.ts](src/palette-worker.ts) | Worker lifecycle, native-conversion requests, and palette generation |
| [src/color/code.ts](src/color/code.ts), [src/color/conversion.ts](src/color/conversion.ts) | Validated hex colors and the Culori/OKLCH adapter |
| [src/color/extraction.ts](src/color/extraction.ts) | Sampling, opacity-weighted histogram, and median-cut swatches |
| [src/color/harmony.ts](src/color/harmony.ts), [src/color/contrast.ts](src/color/contrast.ts) | Harmony recipes, luminance/contrast, and readability search |
| [src/primary.ts](src/primary.ts), [src/variants.ts](src/variants.ts) | Primary-color choices and rule/appearance combinations |
| [src/color/syntax.ts](src/color/syntax.ts), [src/color/theme.ts](src/color/theme.ts) | Syntax palettes, semantic roles, workbench colors, and readability adjustments |
| [src/preview.ts](src/preview.ts) | Live QuickPick previews and session caching |
| [src/application.ts](src/application.ts), [src/ownership.ts](src/ownership.ts) | Configuration writes, ownership tracking, rollback, and restoration |
| [src/report.ts](src/report.ts) | Read-only palette and contrast report |
| [syntaxes/python-html.tmLanguage.json](syntaxes/python-html.tmLanguage.json) | Embedded HTML/JavaScript/CSS highlighting in Python multiline strings |

## Sync lifecycle

```mermaid
flowchart LR
    A[Command or wallpaper change] --> B[Desktop provider]
    B --> C[Local image path and file metadata]
    C --> D[Worker: decode and extract swatches]
    D --> E[Harmony, primary hue, and syntax style]
    E --> F[Theme roles and contrast adjustment]
    F --> G[Journal and apply VS Code settings]
```

Manual Sync discovers the configured wallpaper, generates the selected appearance, checks its contrast targets, and applies it. Automatic sync requires `borrowed-light.autoSync` and a selected Borrowed Light theme. Choosing another theme prevents automatic application.

The GNOME provider watches wallpaper settings and desktop appearance changes. macOS watches its wallpaper store directory and polls wallpaper/appearance every five seconds; Windows uses polling; a 30-second timer on every platform checks for wallpaper and file changes, including replacement at the same path. Notifications are debounced for 500 ms. A signature combines the wallpaper URI, file size/timestamps/inode, harmony, appearance, primary choices, syntax style, and border contrast; unchanged automatic requests skip regeneration.

New requests cancel superseded workers. Revision checks prevent stale results from being applied, and configuration writes run through a serial queue. Failures retain the last applied theme; a partially failed application attempts rollback.

### Previews and persistence

The preview prepares all twelve harmony/appearance combinations from one extraction. Primary-hue and syntax-style changes reuse the extracted swatches and cache results for the session. Automatic application waits while the picker is open. A preview starts in the currently active Borrowed Light appearance, even if the saved preference differs.

Enter saves the selected rule, independent light/dark primary choices, and shared syntax style and border contrast. Escape restores the starting configuration. A preview journal supports recovery after interruption when the extension next activates.

Generated workbench, TextMate, and semantic-token colors live in theme-specific user-settings blocks. The ownership ledger records original values and the extension's last writes before mutations. Restore removes or reverts only values that still match those writes, preserving later manual edits and unrelated settings. Explicit Sync can overwrite generated keys again.

VS Code Settings Sync can carry generated user settings to another installation. The restoration ledger stays in local extension state, and wallpaper paths are not registered as synced extension-state keys. Disable or uninstall does not automatically restore configuration.

### Configuration reference

All preferences are application-scoped under `borrowed-light.*`.

| Setting suffix | Default | Values |
| --- | --- | --- |
| `harmony` | `analogous` | `analogous`, `monochromatic`, `triad`, `complementary`, `compound`, `shades` |
| `appearance` | `desktop` | `dark`, `light`, `desktop` |
| `primaryDark` | `automatic` | `automatic`, `wallpaper-1`…`wallpaper-8`, `harmony-1`…`harmony-5` |
| `primaryLight` | `automatic` | Same source slots, remembered independently for the current wallpaper |
| `syntaxStyle` | `balanced` | `mellow`, `balanced`, `vibrant`, `vibrant-alt` |
| `borderContrast` | `vibrant` | `mellow`, `balanced`, `vibrant`; independent decorative pane contrast |
| `platformProvider` | `auto` | `auto`, `windows`, `macos`, `linux-gnome`; overrides must match the host OS |
| `autoSync` | `false` | Boolean; enables notifications and periodic checks |

## Platform boundary

OS-specific code lives under `src/platform/`: `windows/`, `macos/`, and `linux/gnome/`. Future Linux desktop implementations get sibling subfolders under `linux/`. Linux commands use argument arrays; no user-controlled shell expression is evaluated.

`os_detect.ts` returns a typed OS and Linux desktop identity, with `UNKNOWN` and raw session identifiers for diagnostics. It uses Node's host platform and recognizes colon-separated `XDG_CURRENT_DESKTOP` values, then falls back to `DESKTOP_SESSION`. Recognizing a desktop does not imply provider support.

`os_wallpaper.ts` selects a `WallpaperProvider` with `available()`, `current()`, and optional `watch()` methods. Automatic selection chooses Windows, macOS, or Linux/GNOME. The `platformProvider` setting can select an implemented provider explicitly when session detection is ambiguous; incompatible OS overrides fail clearly. A change stops old monitors and pending generations, reprobes the provider, and waits for that probe before new reads. Unsupported/unavailable providers report the detected environment or missing capability.

GNOME checks background/interface schemas, reads `gsettings`, and parses quoted GVariant strings. GNOME's appearance chooses `picture-uri-dark` or `picture-uri`; an unavailable/empty dark key falls back to the regular wallpaper. Its settings monitors are retained.

Windows runs fixed PowerShell/C# code using built-in Windows PowerShell. [IDesktopWallpaper](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-idesktopwallpaper) supplies per-monitor wallpaper paths. The helper queries primary Win32 monitor geometry, and the TypeScript boundary matches it to the wallpaper monitor rectangles rather than assuming enumeration order. Appearance follows `SystemUsesLightTheme`. No wallpaper settings are changed.

macOS runs fixed JavaScript/Objective-C bridge code with `/usr/bin/osascript`. AppKit's first screen identifies the primary/menu-bar display; [NSWorkspace.desktopImageURL](https://developer.apple.com/documentation/appkit/nsworkspace/desktopimageurl(for:)) provides the legacy fallback. Modern image/aerial selections come from the primary display or shared entry in the user's wallpaper store; aerials use the local cached preview, since NSWorkspace can return a stale default image. The store is undocumented and may change between OS releases. Appearance reads the global AppleInterfaceStyle preference in a fresh helper. The implementation uses framework calls rather than controlling Finder/System Events through Apple Events.

The local UI extension host owns platform helpers, including in remote workspaces. Helpers use fixed source and argument-based execution with bounded stdout/stderr, deadlines, and process termination on cancellation. Windows image bytes travel through stdin; macOS image paths travel as literal sips arguments. No external installations or native Node modules are required.

### Native image fallback

Portable JPEG/PNG decoding stays in `src/image/`, using file signatures rather than extensions. On Windows, unknown formats request WPF/WIC normalization (including BMP); corrupt recognized JPEG/PNG files do not fall back. macOS normalizes all source files through its built-in sips utility to a PNG with a maximum 1024-pixel edge, preserving smaller images. This avoids loading large HEIC/JPEG source files into the worker. Both return bounded PNG bytes to the portable decoder.

The worker sends source bytes (Windows) or a local file request (macOS) to its parent over a native-conversion request. File requests must match the parent-owned pipeline input path. The extension host owns that subprocess and returns normalized bytes; the job's deadline includes conversion. Abort, disposal, timeout, or worker failure stops the outstanding helper so terminating a worker cannot orphan it. Windows conversion stays in memory. macOS uses a private temporary directory for normalization and removes it on success, failure, or cancellation.

Multi-image files use the first still frame. Windows slideshows use the current file reported by the OS; active macOS dynamic frame selection, animations, cropping, and screenshot capture are outside this release. Native codec availability depends on the OS. Built-in helper restrictions and unsupported formats produce errors while retaining the last applied theme.

### Image-processing bounds

The portable worker decoder accepts regular files up to 64 MiB and 32 megapixels; macOS sources are normalized before entering this decoder; native normalized PNG output is also limited to 64 MiB. It has a 15-second deadline and a 128 MiB old-generation heap limit; the JPEG decoder separately has a 512 MiB allocation budget. These limits constrain processing without claiming to cap total process memory at 128 MiB. Native decoders run outside that worker heap and may allocate their own buffers.

The shared JPEG/PNG decoder interprets samples as sRGB without embedded ICC color management; native normalization may perform OS codec color conversions. Transparent pixels are ignored and partially transparent samples are opacity-weighted. Extraction reads the configured image rather than capturing the desktop, so it does not model monitor cropping, overlays, multi-monitor composition, or live transitions.

## Color representations and boundaries

Related calculations live under `src/color/`. `HexColorCode` is a branded string representing exactly an opaque `#RRGGBB` sRGB value. `parseHexColorCode()` validates boundary values, and `isHexColorCode()` narrows unknown values. Accepted spelling is preserved. Shorthand, alpha channels, named colors, and malformed values are excluded from calculations. Brands add no JSON fields and remain ordinary strings in worker messages and VS Code settings.

`toOklch()` and `fromOklch()` exchange an `OklchColor` with named `lightness`, `chroma`, and `hueDegrees` coordinates. Culori's abbreviated coordinates stay inside the conversion adapter. Supplied worker swatches are validated after structured cloning. The report validates raw customization colors separately; unsupported formats are shown as escaped text rather than measured as opaque colors.

Policy constants are grouped beside the algorithms they govern. WCAG coefficients and thresholds are distinguished from custom visual choices such as sampling bounds, recipe stops, hue separation, and saturation limits. Syntax generation returns named family colors instead of numeric slots.

## Color extraction and harmony

Extraction uses a deterministic, opacity-weighted [median-cut quantizer](https://en.wikipedia.org/wiki/Median_cut) over a bounded, regularly sampled RGB histogram. `extractRepresentativeColors()` builds five-bit RGB bins on a regular grid targeting 65,536 samples. It splits the box with the largest channel range × opacity mass at its weighted median, using stable channel/box ordering to resolve ties. Rounded RGB centroids with the same hex value are merged. It returns up to eight representative swatches ordered by sample weight. `generateHarmonyPalette()` uses the first sufficiently chromatic swatch with at least 1% weight seeds the harmony; otherwise, the harmony remains neutral.

Recipes use **OKLCH**: lightness, chroma, and hue angle, the cylindrical representation of Oklab. This separates hue changes from tonal adjustments. Colors outside sRGB reduce chroma to fit the gamut. See [Oklab and OKLCH](https://en.wikipedia.org/wiki/Oklab_color_space) for background and the [W3C CSS Color specification](https://www.w3.org/TR/css-color-4/#ok-lab) for the color-space definition.

The following are Borrowed Light's implementations of familiar [color-scheme concepts](https://en.wikipedia.org/wiki/Color_scheme). Hue angles are measured in OKLCH; the recipes do not promise to reproduce another tool's color wheel.

| Rule | Approach in Borrowed Light | Theory background |
| --- | --- | --- |
| Analogous | Seed hue and neighbors at ±30° and ±60° | [Adjacent hues](https://en.wikipedia.org/wiki/Color_scheme#Analogous) |
| Monochromatic | One hue with five lightness/chroma combinations | [Monochromatic schemes](https://en.wikipedia.org/wiki/Color_scheme#Monochromatic) |
| Triad | Seed, +120°, +240°, plus two tonal variants | [Evenly spaced hues](https://en.wikipedia.org/wiki/Color_scheme#Evenly_spaced_hues) |
| Complementary | Seed and +180° complement, plus tonal variants | [Complementary schemes](https://en.wikipedia.org/wiki/Color_scheme#Complementary) |
| Compound | Seed, ±30° neighbors, and +150°/+210° split complements | [Split-complementary background](https://en.wikipedia.org/wiki/Color_scheme#Complementary); the five-color combination is this project's recipe |
| Shades | Seed hue/chroma with descending lightness | [Tints and shades](https://en.wikipedia.org/wiki/Tint,_shade_and_tone) |

Harmony colors may be derived rather than observed in the image. Primary-hue selection offers extracted swatches and harmony slots separately. Preferences store source slots rather than fixed hex values; a missing slot falls back to Automatic. Changing the primary hue changes surfaces and accents without changing the harmony recipe.

Light surfaces use weighted wallpaper lightness/chroma and the selected primary hue to vary their brightness and tint. Grayscale wallpapers remain neutral.

## Syntax palette selection

Syntax roles cover keywords, strings, numbers/constants, functions, types, and identifiers. Both TextMate and semantic-token rules receive assignments. The syntax styles are project-specific design choices, informed by hue spacing and chroma rather than a separate standardized color harmony.

| Style | Color source and adjustment | Identifier treatment |
| --- | --- | --- |
| Mellow | Harmony palette with strongly reduced chroma | Close to primary text color |
| Balanced | Harmony palette with moderate chroma | Neutral identifiers; default style |
| Vibrant | Separated observed wallpaper hues plus harmony/derived accents, with stronger chroma | Colorful variables, parameters, and properties |
| Vibrant Alternate | Same vibrant palette, rotated by one source slot | Different assignment of colors to syntax families |

Vibrant selection first chooses separated observed hues, then combines them with harmony candidates. It favors candidates at least 40° from already selected hues. If fewer than six sufficiently distinct sources exist, it derives more accents by bisecting the largest remaining hue-wheel gaps. This keeps a mostly green wallpaper from making every syntax family green. Derived accents are not reported as extracted wallpaper colors; fully grayscale sources remain neutral.

Token lightness is chosen for light or dark backgrounds, then each role goes through the contrast adjustment below. Comments and punctuation remain restrained. Syntax style is shared between appearances and does not change the primary hue or workbench palette.

The Python grammar injection recognizes HTML document roots inside ordinary/raw multiline strings and delegates HTML, script, and style content to existing language grammars. Ordinary strings retain Python coloring, and formatted strings retain Python interpolation handling. This contribution applies across themes while the extension is enabled.

## Contrast measurement and adjustment

Readability uses the WCAG relative-luminance contrast ratio, distinct from visual hue separation. sRGB channels are linearized, then combined as `Y = 0.2126 R + 0.7152 G + 0.0722 B`. Contrast is `(lighter Y + 0.05) / (darker Y + 0.05)`, ranging from 1:1 to 21:1. See [W3C's contrast explanation](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

The current `balancedPolicy` targets **4.5:1** for primary/secondary text, comments, syntax categories, buttons, and field text against their assigned backgrounds. Essential focus indicators target **3:1**, informed by [W3C non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

`ensureReadableColor()` searches for the nearest passing OKLCH lightness while retaining the source hue/chroma where gamut permits. It checks the final quantized 8-bit sRGB hex values against every background assigned to that role. The search visits 1,001 lightness values from 0 to 1; strict distance comparisons retain the earlier (darker) candidate on equal distances. This search resolution is a custom policy. Black/white are fallbacks; an impossible assignment raises an error rather than silently returning a failing color.

The report shows pairwise contrast matrices for extracted/harmony palettes, role adjustments, and foreground/background checks. An arbitrary pair of palette colors has no universal pass/fail requirement; its assigned UI role determines the target.

These checks cover controlled theme roles, not every rendered pixel or an overall WCAG conformance claim. Workspace/language overrides, additional token scopes, third-party webviews, transparency, and terminal programs can change actual pairings. Diagnostic and terminal status colors preserve recognizable meanings rather than strictly following the harmony.

## Extension points

- Add OS/desktop discovery and notifications through `WallpaperProvider` and `providerRegistry`.
- Add portable formats in `src/image/` or native codecs under `src/platform/`, keeping extraction independent of discovery.
- Extend harmony and syntax strategies through the palette/variant stages.
- Add future high-contrast or focused modes through `ContrastPolicy`, preserving primary text requirements while adjusting secondary/comment emphasis. Only the balanced policy is currently exposed.

See [Developing](DEVELOPING.md) for build and test workflows, or return to the [user guide](README.md).

Decorative pane/widget borders have an independent `borderContrast` preference. Mellow and Balanced use muted surface hues with custom minimum contrast targets of 1.15:1 and 1.5:1 against editor, panel, and field surfaces. Vibrant preserves the original indicator color. Keyboard focus, search matches, and control outlines keep the existing indicator contrast policy. Border preference is included in pipeline inputs, preview caches, signatures, and the report; only accepting a preview writes its new setting.

Preview light/dark appearance is transient: committing a preview never writes the appearance preference. The desktop-following command freezes the active editor appearance when following is turned off. `WallpaperPrimaries` persists the last successfully used source signature separately from appearance/syntax; a changed source uses automatic primaries, and a successful sync resets both primary settings. Accepted previews bind their hue choices to the source they sampled. Failed syncs and cancelled previews do not advance the binding. Existing unbound preferences migrate on the first successful sync.
