# Developing Borrowed Light

## Prerequisites

Use Node.js **24** and npm to match CI. VS Code **1.128 or later** is required to run the extension. Automated host tests download a VS Code build unless an installed executable is specified.

On headless Linux, host tests require `xvfb` and the system libraries needed by VS Code/Electron. The [CI workflow](.github/workflows/ci.yml) lists its Ubuntu dependencies. A local supported desktop session and wallpaper are required only for real desktop smoke tests and manual wallpaper syncing. These development dependencies are separate from the user installation, which requires no additional wallpaper-processing tools.

## Install, build, and run

From the repository root:

```sh
npm ci
npm run compile
```

`compile` checks types, runs ESLint, and bundles the extension and palette worker into `dist/`. Open the repository in VS Code and press **F5** to launch an Extension Development Host. Its launch task watches TypeScript and the bundles. In the development window, run **Borrowed Light: Sync Theme from Wallpaper** or **Borrowed Light: Preview Color Schemes**.

For a terminal-driven watch session:

```sh
npm run watch
```

## Type checks and lint

```sh
npm run check-types
npm run lint
```

Both checks also run during `compile` and the production `package` build.

## Automated tests

```sh
npm run test:unit
npm run test:host
```

Run the unit command first: it builds the bundles, compiles tests to `out/`, and runs the Node.js unit suite. The suite covers extraction, harmony/contrast behavior, syntax diversity, worker processing/cancellation, platform detection/routing, provider parsing, native-helper lifecycle, and ownership restoration. Windows runs the actual BMP helper and macOS the actual HEIC helper against committed fixtures; those native codec tests are skipped on Linux. Compile-only checks enforce the validated color contract. `color-regression.test.ts` fingerprints 768 complete theme variants, organized by syntax style, and compares extraction fixtures. Mellow retains the previous Balanced look, both Vibrant styles retain their prior output, and the new Balanced palette has intentional wallpaper-derived baselines. Fingerprints keep colors exact and round reported contrast ratios to 10 decimal places to tolerate Node/V8 floating-point differences; update those baselines only when intentionally changing generated output. If bundles are already built and only host tests changed, `npm run compile-tests` refreshes the compiled tests.

Host tests run in an isolated VS Code profile and exercise commands, live configuration, previews, persistence/restoration, and real language grammar scopes. The [test configuration](.vscode-test.mjs) selects the test files and launch options. `npm test` runs both suites in order.

To use an installed VS Code executable:

```sh
VSCODE_EXECUTABLE_PATH=/path/to/code npm run test:host
```

For headless Linux with the default downloaded build:

```sh
xvfb-run -a -s '-screen 0 1440x1000x24' \
  env WAYLAND_DISPLAY= XDG_SESSION_TYPE=x11 npm run test:host
```

Add `VSCODE_EXECUTABLE_PATH=/path/to/code` to that `env` command to use an installed copy instead.

### Windows/macOS desktop smoke tests

Set `BORROWED_LIGHT_NATIVE_SMOKE=1` when running `npm run test:host` in a real Windows/macOS desktop session. PowerShell users can set `$env:BORROWED_LIGHT_NATIVE_SMOKE = '1'` first. This opt-in test reads the primary display wallpaper, syncs, and opens the report. It restores the settings it changes. Native decoding tests run automatically in the unit suite on their matching OS; actual desktop discovery remains a separate manual/session check.

### GNOME desktop smoke tests

The GNOME tests are skipped by default because they need a real local session with accessible wallpaper settings. Enable them on a supported desktop:

```sh
BORROWED_LIGHT_GNOME_SMOKE=1 npm run test:host
```

They exercise actual wallpaper syncing, appearance preservation while cycling rules, language editors, the contrast report, and auto-sync preferences. The tests restore the settings they modify.

Optional screenshots require ImageMagick's `import` command and a capture-capable display. Create the output directory and supply it to the host tests:

```sh
mkdir -p /tmp/borrowed-light-screenshots
BORROWED_LIGHT_GNOME_SMOKE=1 \
BORROWED_LIGHT_SCREENSHOT_DIR=/tmp/borrowed-light-screenshots \
npm run test:host
```

Screenshot tooling is for development only and is not needed to use the extension.

## Production build and VSIX

```sh
npm run package
npm run vsix
```

`package` performs type/lint checks and builds minified bundles. `vsix` invokes that production build through `vscode:prepublish`, then packages `borrowed-light-0.0.12.vsix`. The extension bundle, worker, themes, grammar contribution, and documentation are included; source/test/build tooling is excluded by [.vscodeignore](.vscodeignore). Install the result with **Extensions: Install from VSIX…**.

The `borrowed-light-local` publisher is a local packaging placeholder. Replace it with your registered publisher before Marketplace publication. The project has not selected a distribution license; the local packaging command skips that prompt. Bundled dependency licenses are reproduced in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Continuous integration

[GitHub Actions CI](https://github.com/ASethi77/borrowed_light/actions/workflows/ci.yml) runs on pushes to `main`, pull requests, and manual dispatch. Its Node.js 24 matrix runs on Ubuntu 24.04, Windows 2025, and macOS 15. Each runner installs with `npm ci` and runs type/lint/unit and VS Code host tests; Linux uses Xvfb. Windows/macOS unit tests execute their native decoders. Only Linux packages and uploads the VSIX.

Successful runs upload a `borrowed-light-vsix` artifact retained for 14 days. Hosted CI skips opt-in live desktop discovery smoke tests on all OSes and does not publish to the Marketplace. Workflow configuration stays in [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Manual verification

Try colorful and grayscale JPEG/PNG wallpapers in both appearances, plus BMP on Windows and HEIC on macOS. With distinct wallpapers on multiple displays, verify Windows/macOS choose the primary display. Test automatic provider detection and a compatible override; an incompatible override must leave the applied theme intact. Cycle rules, primary hues, and syntax styles; inspect TypeScript/Python/Markdown, buttons, fields, selections, sidebar, status bar, terminal, and notifications. Test Enter/Escape and verify that changing rules keeps the active appearance.

Then change the wallpaper with auto-sync enabled, select a different theme to verify pausing, edit a generated setting, and run Restore to confirm the manual edit survives. Run Restore in the development window when you want to remove its applied theme settings.

See [Architecture](ARCHITECTURE.md) for module boundaries and color algorithms, or return to the [user guide](README.md).

## Automatic setup and independent sync checks

The lifecycle unit suite runs activation against controlled VS Code/platform adapters. It checks first installation, migration, welcome state, all four sync combinations, retained swatches across restart/source removal, cancellation, manual sync, and Restore. Native providers expose appearance reads that do not discover or decode a wallpaper. Existing native CI tests still run on their matching OS.

In a fresh VS Code profile, install the VSIX and verify immediate system-mode wallpaper sync and the one-time welcome page. Reopen the window and verify the page does not reopen. Check both status-bar toggles independently, then change the wallpaper and system mode. With wallpaper sync off, appearance must follow using the previous image's palette. Select another VS Code theme to confirm Paused; Restore must disable both sources.

Compare saturated blue/green wallpapers using all light tint presets. Subtle should keep editor, sidebar, status bar, and input surfaces quiet while vibrant syntax retains multiple hues. Dark defaults must match the original colorful policy. The two appearance-specific tint settings must not affect each other's output.
