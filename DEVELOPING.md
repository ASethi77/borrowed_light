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

## Profiling images, palettes, and wallpaper sync

Start with the measurement that matches the slowdown:

| Question | Measurement | Includes |
| --- | --- | --- |
| Does a large wallpaper take too long or use too much memory? | Image profiler below | Source inspection, normalization, palette extraction, one generated theme, and cleanup |
| Is decoding or palette generation responsible? | JSON stage timings, then the palette benchmark | Separate normalization and palette timings; optional CPU profile of palette functions |
| Is changing the actual wallpaper slow? | Extension Development Host workflow below | Desktop discovery/notifications, debounce, pipeline, settings persistence, and visible theme application |

The image profiler runs the production image pipeline outside VS Code. Its
`--repeats` option repeats pipeline jobs; it does **not** exercise desktop
notifications, the extension's saved-palette behavior, or VS Code theme writes.

### Profile a real wallpaper first

Run this from the repository root. An existing file needs Node/npm only; Python
and Pillow are needed only when generating the fixture suites.

```sh
npm run profile:images -- --file "path/to/wallpaper.jpg" --decoder both --limit-mp 512 --runs 5 --repeats 20 --output profiling-results/wallpaper-baseline
```

For the reference wallpaper in Windows PowerShell:

```powershell
npm.cmd run profile:images -- --file "C:\Users\aakas\Pictures\yosemite_unsplash.jpg" --decoder both --limit-mp 512 --runs 5 --repeats 20 --output profiling-results/yosemite-baseline
Invoke-Item profiling-results/yosemite-baseline/report.html
```

Open `report.html` for the overview, `report.csv` for comparisons, and
`report.json` for stage timings and detailed memory data. The command builds
first, but build time is excluded from the measurements. `--limit-mp` applies to
this profiling run; it does not change the extension setting. `--decoder auto`
tests the production choice (native on Windows/macOS, portable on Linux).

Five runs produce five independent subprocess measurements per backend. The
additional `-repeated` row runs 20 sequential pipeline jobs within one subprocess.
For a quick debugging run use `--runs 1 --repeats 0`. Output files are overwritten
when reusing a directory, so use separate `before` and `after` destinations.

### Read stage timings and memory

The JSON report's `rows` contain these measurements:

| Field | Interpretation |
| --- | --- |
| `events`, stage `normalization` | File reads, decoder/helper startup, source checks, resize/orientation, and thumbnail PNG production; excludes time waiting for the shared normalization queue |
| `events`, stage `palette` | From sending the thumbnail to receiving the result: thumbnail PNG decoding, representative-color extraction, harmony/theme generation, and message overhead |
| `durationMs` | Entire measured job: initial source inspection, worker startup, queue waits, normalization, palette processing, correctness checks, and awaited cleanup; for repeated rows this covers all jobs |
| `resources.sampledTreePeakBytes` | Highest sampled simultaneous RSS sum for the workload process and its helpers |
| `nodeHighWaterBytes` | Node process OS high-water RSS; native helper processes are reported separately under `resources` |
| `events`, stage `portable-memory` | WASM linear memory and worker memory snapshot near completion; not a continuous peak measurement |
| `retained` | Node memory snapshots after each pipeline job; use repeated rows to inspect growth, allowing for GC and allocator reuse |
| `activeResourceDelta` | Difference in active worker/helper resource counts after cleanup; positive values fail qualification |

There is no separate disk-read timer: source reads overlap decoding and are
included in normalization. Palette timing combines extraction and theme
generation. Stage durations need not add up to `durationMs`, and unsuccessful
stages may have no completion event. Divide repeated-row totals by `jobs` only
when comparing average cost per job; keep peak memory as a peak.

For a compact stage breakdown, save this as `.cache/read-image-profile.cjs`
(create `.cache` first if needed), then run
`node .cache/read-image-profile.cjs profiling-results/wallpaper-baseline/report.json`:

```js
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.table(report.rows.map(row => {
    const averageStage = stage => (row.events ?? [])
        .filter(event => event.stage === stage)
        .reduce((sum, event) => sum + (event.durationMs ?? 0), 0) / row.jobs;
    return {
        case: row.id, decoder: row.decoder, outcome: row.outcome, jobs: row.jobs,
        totalMsPerJob: row.durationMs / row.jobs,
        normalizationMsPerJob: averageStage('normalization'),
        paletteMsPerJob: averageStage('palette'),
        peakMiB: (row.resources?.sampledTreePeakBytes ?? 0) / 1048576,
        activeResourceDelta: row.activeResourceDelta,
    };
}));
```

Compare successful rows with identical source hashes, limits, Node versions,
backends, and theme inputs. Compare several runs using the median and range,
alongside peak memory; do not infer a regression from one run. A fresh subprocess
does not imply cold filesystem caches. Keep the machine idle, record power mode,
and compare platforms against their own baselines. The current CLI always
generates one analogous dark theme with Balanced syntax and vibrant borders;
it does not benchmark every preview or syntax/tint combination.

### Isolate extraction and theme generation

If palette time dominates, benchmark the synchronous functions with a bounded
photographic fixture. This separates extraction from theme construction and lets
Node capture their CPU stacks in the process doing the work. Run
`npm run compile-tests`, then save this as `.cache/profile-palette.cjs`:

```js
const { readFileSync } = require('node:fs');
const { performance } = require('node:perf_hooks');
const { decodePixels } = require('../out/image/decode.js');
const { extractRepresentativeColors } = require('../out/color/extraction.js');
const { generateVariant, generateVariants } = require('../out/variants.js');
const bytes = readFileSync('src/test/fixtures/astronaut.png');
const pixels = decodePixels(bytes);
const extract = () => extractRepresentativeColors(pixels.data, pixels.width, pixels.height);
const swatches = extract();
function measure(name, action, count = 20) {
    action(); // Warm up separately from the timed iterations.
    const start = performance.now();
    for (let index = 0; index < count; index++) { action(); }
    console.log(`${name}: ${((performance.now() - start) / count).toFixed(2)} ms/op`);
}
measure('thumbnail PNG decode', () => decodePixels(bytes));
measure('palette extraction', extract);
measure('one dark theme', () => generateVariant(swatches, 'analogous', 'dark'));
measure('all 12 preview themes', () => generateVariants(swatches), 3);
```

```sh
node .cache/profile-palette.cjs
node --cpu-prof --cpu-prof-dir=.cache .cache/profile-palette.cjs
```

Open the generated `.cpuprofile` in VS Code to inspect expensive call stacks.
Change the fixture and explicit `generateVariant` arguments to reproduce a
specific harmony, appearance, syntax style, border contrast, or tint. These
numbers exclude source normalization, worker startup/transfer, and theme
application; use them to explain pipeline results, not as end-to-end latency.
The profiler's main process and extension host CPU profiles do not capture all
CPU stacks inside separate workers or native decoder helpers.

### Measure actual wallpaper sync in VS Code

1. Run `npm run compile`, then **F5** to open an Extension Development Host. Keep
   other extensions and background work to a minimum. For comparable timings,
   repeat without breakpoints; debugger pauses invalidate latency measurements.
2. Open **View: Toggle Output**, select **Borrowed Light**, and run
   **Borrowed Light: Sync Theme from Wallpaper** once to establish a saved palette.
   For images above 256 MP, set `borrowed-light.maxImageMegapixels` to the same
   limit used in the CLI run.
3. Open **Developer: Show Running Extensions**, start recording an extension host
   profile using its toolbar control, reproduce the scenario, stop, and save the
   profile. This is the [VS Code extension profiling workflow](https://github.com/microsoft/vscode/wiki/Performance-Issues#profile-the-running-extensions).
4. Use **Help: Open Process Explorer** to watch the extension host and helper
   processes during the run. If the editor itself paints slowly, also capture the
   renderer's Performance recording through **Help: Toggle Developer Tools**.
   A renderer recording and an extension host recording cover different processes.
5. Run each scenario below several times, changing one variable at a time. Keep
   the image, settings, OS, VS Code version, and event-to-visible-update latency
   with the saved profile and CLI report.

| Scenario | How to reproduce | What it exercises |
| --- | --- | --- |
| Manual full sync | Run Sync Theme from Wallpaper repeatedly | Provider discovery, source inspection, full image pipeline, theme writes, and saved-palette persistence; manual sync refreshes even for the same file |
| Automatic wallpaper change | Enable wallpaper following, select a Borrowed Light theme, then alternate two wallpapers through OS settings | Native notification/polling, 500 ms debounce, full pipeline, and theme application |
| Appearance-only change | Disable wallpaper following, keep desktop appearance following enabled, then toggle system light/dark | Saved swatches and theme generation without reopening the source image |
| Preview cost | Open Preview Color Schemes, then cycle rules/colors/syntax | Initial preview generation versus subsequent regeneration from swatches; report these separately |
| Idle / cancellation | Leave syncing idle, then change wallpapers rapidly and select another theme | Idle CPU/memory, superseded-job cleanup, and absence of stale theme application |

The Output channel records applied themes and errors, but currently has no
per-stage sync timers. The CLI's `durationMs` is not desktop-event-to-visible-theme
latency. For exact local wall-time attribution, temporarily add
`performance.now()` timestamps in `src/extension.ts`: at provider notification
before `schedule()`, entry to `sync()`, around `read()`, `generate()`,
`application.apply()`, and the following persistence writes. Use one revision/job
identifier so cancelled generations cannot be mixed together, and remove those
probes after debugging. CPU profiles show execution hotspots, not all asynchronous
waiting or renderer repaint time. Notification latency also depends on the
provider's polling/fallback behavior. CI's current resource reports exercise the
image pipeline; live desktop sync and visible repaint latency remain local checks.

### Qualify generated large-image suites and CI reports

Normal extension builds use the checked-in WASM codec and verify its SHA-256.
Rebuilding it requires the development toolchain described in [codec/README.md](codec/README.md);
none of those tools are required by extension users.

For generated large-image fixtures, install Python **3.13** and the pinned,
development-only Pillow dependency inside the workspace:

```sh
python -m pip install --target .cache/profiling-python -r tools/profiling-requirements.txt
npm run profile:images -- --suite smoke --decoder both
npm run profile:images -- --suite full --decoder both
npm run profile:images -- --file "path/to/wallpaper.jpg" --decoder both --limit-mp 512
```

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`.
The profiler does not read or change desktop wallpaper settings or apply themes.
`auto` selects the production backend; `native` and `portable` force a backend;
`both` compares both on Windows/macOS and explicitly records native unavailability
on Linux. No corrupt-image fallback is performed.

The smoke suite covers the reference wallpaper's dimensions, 256 MP, 512 MP,
JPEG/PNG, a progressive JPEG, alpha, a public-domain photograph, and rejection
above the default 256 MP limit. The full suite adds 8/32/64/128 MP, progressive
JPEG through 512 MP, panoramas, deterministic noise/gradients, and larger
photographic derivatives. This is pairwise size/content coverage, not every
combination. Generated assets live in `.cache/image-fixtures` and stay out of git
and VSIX packages. Fixture-generation time and memory are excluded from results.

Each measurement starts a fresh Node process and invokes the production pipeline.
Filesystem caches are uncontrolled. Full coverage defaults to three runs per case
and a separate 20-sync test in one process; override these with `--runs 1` and
`--repeats 0`. A source above 256 MP automatically uses an opt-in limit matching
its size, followed by a default-limit rejection check. An explicit `--limit-mp`
overrides that suite behavior. Individual-file profiling defaults to 256 MP.

Reports are written as JSON, CSV, HTML, and Markdown under `profiling-results/`;
use `--output profiling-results/my-run` for a stable destination. JSON includes
source hashes, effective policy, stage timings, per-process measurements, Node
high-water RSS, heap/external/array-buffer figures, portable WASM memory,
per-sync retained memory, logs, environment, codec versions, and git revision.
Absolute input paths are redacted; the filename remains. Profiling your own file
does not copy it into the reports or repository.

The collector samples the workload and its descendants every 50 ms. It excludes
the controller and collector, and does not double-count worker threads as separate
processes. Linux uses `/proc` and `getconf`; Windows uses a persistent PowerShell
helper with core process APIs; macOS uses `ps`. Per-process OS high-water values
are available on Windows/Linux and for the Node process on all platforms. macOS
helper high-water values are marked unavailable. Helper high-water readings are
observed while a process is alive and may miss its final peak. Sampled CPU is a lower bound for
short helpers. Summed RSS may count shared pages repeatedly, and polling can miss
short peaks. Individual process high-water values are never summed and described
as simultaneous memory usage. A pixel limit and JS worker heap limit are not RSS
caps; progressive JPEG can allocate large coefficient arrays.

CI runs smoke qualification on pull requests/pushes and full qualification weekly
or through **Run workflow → profiling_suite**. Windows/macOS compare native and
portable paths; Linux exercises the portable backend. Additional Linux container
tests cover glibc and musl without image packages. CI uploads reports even after
failures, combines platform reports, and independently rebuilds/verifies WASM.
Correctness, cleanup, instrumentation errors, and missing-platform reports fail
CI. Timing and memory are informational initially. Collect at least ten successful
scheduled baselines before proposing platform-specific regression budgets.

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

Each host-test invocation creates a fresh temporary VS Code profile with wallpaper sync disabled and appearance fixed to dark before activation. This prevents real desktop updates and persisted wallpaper swatches from overwriting fixture previews on CI. Desktop smoke tests enable the relevant behavior explicitly; the lifecycle unit suite covers automatic first installation. Host tests exercise commands, live configuration, previews, persistence/restoration, and real language grammar scopes. The [test configuration](.vscode-test.mjs) selects the test files and launch options. `npm test` runs both suites in order.

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

`package` performs type/lint checks and builds minified bundles. `vsix` invokes that production build through `vscode:prepublish`, then packages `borrowed-light-<version>.vsix`, using the version in `package.json`. The extension bundle, worker, themes, grammar contribution, and documentation are included; source/test/build tooling is excluded by [.vscodeignore](.vscodeignore). Install the result with **Extensions: Install from VSIX…**.

Before packaging a new release, bump the version with one of:

```sh
npm run bump -- patch    # 0.0.13 -> 0.0.14
npm run bump -- minor    # 0.0.13 -> 0.1.0
npm run bump -- major    # 0.0.13 -> 1.0.0
npm run bump -- 1.2.3    # set an explicit version
npm run vsix
```

`bump` updates `package.json` and `package-lock.json` together without creating a Git commit or tag. Commit both files with the release changes. The VSIX filename follows the version automatically; the packaging command needs no manual edits. Running `vsix` alone does not change the version.

The publisher is `ASethi77`. The project has not selected a distribution license; the local packaging command skips that prompt. Bundled dependency licenses are reproduced in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

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
