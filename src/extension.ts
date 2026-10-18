import * as vscode from 'vscode';
import { stat } from 'node:fs/promises';
import { ThemeApplication } from './application';
import { Appearance, harmonies, Harmony, PaletteResult, PreviewVariants, Wallpaper, PrimaryChoices, SyntaxStyle, syntaxStyles, BorderContrast, borderContrasts, BackgroundTint, BackgroundTints, backgroundTints, Swatch } from './model';
import { Cancelled, runPipeline, runPreviews, runVariant } from './pipeline';
import { isPrimaryChoice } from './primary';
import { createPreviewPicker, PreviewPicker } from './preview';
import { selectProvider } from './platform/os_wallpaper';
import { detectPlatform } from './platform/os_detect';
import { wallpaperPath } from './image/source';
import { reportHtml } from './report';
import { themeNames } from './color/theme';
import { WallpaperPrimaries } from './wallpaper_preferences';
import { installationKey, installationKind, WallpaperSnapshots, syncIndicatorState } from './sync_state';
import { WelcomePage } from './welcome';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const configAtStartup = vscode.workspace.getConfiguration('borrowed-light');
    const propertyNames = Object.keys(context.extension.packageJSON.contributes.configuration.properties as Record<string, unknown>);
    const explicitPreferences = propertyNames.some(key => configAtStartup.inspect(key.replace('borrowed-light.', ''))?.globalValue !== undefined);
    const installation = installationKind(context.globalState, explicitPreferences);
    if (installation === 'existing' && configAtStartup.inspect('autoSync')?.globalValue === undefined) {
        // Upgrades retain the old effective default. Fresh profiles get the new default.
        await configAtStartup.update('autoSync', false, vscode.ConfigurationTarget.Global);
    }
    if (installation !== 'initialized') { await context.globalState.update(installationKey, true); }
    const welcome = new WelcomePage(context.extensionUri);
    const snapshots = new WallpaperSnapshots(context.globalState);
    const output = vscode.window.createOutputChannel('Borrowed Light');
    const platform = detectPlatform();
    let provider = await selectProvider(platform, vscode.workspace.getConfiguration('borrowed-light').get('platformProvider', 'auto'));
    output.appendLine(`Platform: ${platform.os}/${platform.desktop}; provider: ${provider.id}`);
    const application = new ThemeApplication(context.globalState);
    const wallpaperPrimaries = new WallpaperPrimaries(context.globalState);
    try { await application.recoverPreview(); } catch (value) { output.appendLine(`Could not restore an interrupted preview: ${String(value)}`); }
    const workerPath = context.asAbsolutePath('dist/palette-worker.js');
    let disposed = false, revision = 0, signature = '', lastError = '';
    let busy = false, monitorFallback = false;
    let updateStatus = () => {};
    const followsAppearance = () => settings().get<string>('appearance', 'desktop') === 'desktop';
    const followsWallpaper = () => settings().get<boolean>('autoSync', true);
    const automaticEnabled = () => followsWallpaper() || followsAppearance();
    let providerRevision = 0;
    let providerUpdate = Promise.resolve();
    let cached: { signature: string; result: PaletteResult } | undefined;
    let abort: AbortController | undefined;
    let monitor: { dispose(): void } | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let writes = Promise.resolve();
    let preview: PreviewPicker | undefined;
    let previewOpening = false;
    const reportWorkers = new Set<AbortController>();
    const settings = () => vscode.workspace.getConfiguration('borrowed-light');
    const serialized = (action: () => Promise<void>): Promise<void> => {
        const next = writes.then(action);
        writes = next.catch(() => {});
        return next;
    };
    const cancel = () => { revision++; abort?.abort(); busy = false; updateStatus(); };
    const error = (value: unknown, manual: boolean) => {
        if (value instanceof Cancelled) { return; }
        const message = value instanceof Error ? value.message : String(value);
        if (manual || message !== lastError) { output.appendLine(message); }
        lastError = message; updateStatus();
        if (manual) { void vscode.window.showErrorMessage(`Borrowed Light: ${message}`); }
    };
    const read = async (refreshWallpaper = followsWallpaper()) => {
        // Wait for the latest override probe before manual sync/report/preview reads.
        let pending: Promise<void>;
        do { pending = providerUpdate; await pending; } while (pending !== providerUpdate);
        if (disposed) { throw new Cancelled(); }
        const config = settings();
        const harmony = config.get<Harmony>('harmony', 'analogous');
        if (!harmonies.includes(harmony)) { throw new Error('Unknown harmony setting'); }
        const requestedPrimaries: PrimaryChoices = { dark: config.get('primaryDark', 'automatic'), light: config.get('primaryLight', 'automatic') };
        if (!isPrimaryChoice(requestedPrimaries.dark) || !isPrimaryChoice(requestedPrimaries.light)) { throw new Error('Unknown primary color setting'); }
        const syntaxStyle = config.get<SyntaxStyle>('syntaxStyle', 'balanced');
        if (!syntaxStyles.includes(syntaxStyle)) { throw new Error('Unknown syntax style setting'); }
        const borderContrast = config.get<BorderContrast>('borderContrast', 'balanced');
        if (!borderContrasts.includes(borderContrast)) { throw new Error('Unknown border contrast setting'); }
        const tints: BackgroundTints = { light: config.get<BackgroundTint>('backgroundTintLight', 'subtle'), dark: config.get<BackgroundTint>('backgroundTintDark', 'colorful') };
        if (!Object.values(tints).every(tint => backgroundTints.includes(tint))) { throw new Error('Unknown background tint setting'); }
        const requested = config.get<string>('appearance', 'desktop');
        if (!['dark', 'light', 'desktop'].includes(requested)) { throw new Error('Unknown appearance setting'); }
        const saved = snapshots.read();
        if (!refreshWallpaper && !saved) { throw new Error('Sync Theme from Wallpaper once to save a palette for system appearance following.'); }
        let wallpaper: Wallpaper, path: string | undefined, sourceSignature: string, swatches: Swatch[] | undefined;
        if (refreshWallpaper) {
            wallpaper = await provider.current();
            path = wallpaperPath(wallpaper.uri);
            const metadata = await stat(path);
            sourceSignature = JSON.stringify([wallpaper.uri, metadata.size, metadata.mtimeMs, metadata.ctimeMs, metadata.ino]);
        } else {
            wallpaper = { ...saved!.wallpaper, appearance: requested === 'desktop' ? await provider.appearance() : saved!.wallpaper.appearance };
            sourceSignature = saved!.sourceSignature;
            swatches = saved!.swatches;
        }
        const appearance = requested === 'desktop' ? wallpaper.appearance : requested as Appearance;
        const backgroundTint = tints[appearance];
        const { primaries, reset: resetPrimaries } = wallpaperPrimaries.resolve(sourceSignature, requestedPrimaries);
        return { wallpaper, path, swatches, harmony, appearance, primaries, resetPrimaries, syntaxStyle, borderContrast, backgroundTint, tints, sourceSignature,
            signature: JSON.stringify([sourceSignature, harmony, appearance, primaries, syntaxStyle, borderContrast, backgroundTint]) };
    };
    const generate = (source: Awaited<ReturnType<typeof read>>, signal?: AbortSignal) => source.swatches
        ? runVariant(workerPath, source.swatches, source.harmony, source.appearance, source.primaries[source.appearance], signal, source.syntaxStyle, source.borderContrast, source.backgroundTint)
        : runPipeline(workerPath, source.path!, source.harmony, source.appearance, signal, source.primaries[source.appearance], source.syntaxStyle, undefined, source.borderContrast, source.backgroundTint);

    const sync = async (manual: boolean, bootstrap = false, preferences = false): Promise<void> => {
        if (disposed || preview || previewOpening || (!manual && ((!automaticEnabled() && !preferences) || (!bootstrap && !application.ownedThemeActive)))) { return; }
        // An explicit Sync supersedes a queued settings refresh. Otherwise its timer
        // can cancel a slow image decode and make the command return before applying.
        if (debounce) { clearTimeout(debounce); debounce = undefined; }
        cancel();
        const currentRevision = revision;
        busy = true; updateStatus();
        abort = new AbortController();
        const signal = abort.signal;
        try {
            const source = await read(manual || (!preferences && followsWallpaper()));
            if (currentRevision !== revision || disposed) { return; }
            if (!manual && source.signature === signature) { return; }
            const result = await generate(source, signal);
            if (result.theme.checks.some(check => check.ratio < check.minimum)) { throw new Error('Generated theme failed its contrast checks'); }
            if (currentRevision === revision) { cached = { signature: source.signature, result }; }
            await serialized(async () => {
                if (currentRevision !== revision || disposed || (!manual && !bootstrap && !application.ownedThemeActive)) { return; }
                const applied = await application.apply(result.theme, () => currentRevision === revision && !disposed && (manual || bootstrap || application.ownedThemeActive));
                if (!applied) { return; }
                if (source.resetPrimaries) {
                    await settings().update('primaryDark', 'automatic', vscode.ConfigurationTarget.Global);
                    await settings().update('primaryLight', 'automatic', vscode.ConfigurationTarget.Global);
                    output.appendLine('Wallpaper changed; primary colors reset to automatic.');
                }
                await wallpaperPrimaries.remember(source.sourceSignature);
                await snapshots.remember({ wallpaper: source.wallpaper, sourceSignature: source.sourceSignature, swatches: result.swatches });
                signature = source.signature; lastError = '';
                if (bootstrap || installation === 'fresh') { welcome.update('ready'); }
                updateStatus();
                output.appendLine(`Applied ${result.theme.appearance} ${source.harmony} theme from ${source.wallpaper.uri}`);
                if (manual) {
                    const warnings = application.overrideWarnings(result.theme);
                    if (warnings.length) { output.appendLine(warnings.join('\n')); }
                    void vscode.window.showInformationMessage(warnings.length ? 'Wallpaper theme generated. Some settings may override it; see the contrast report.' : 'Theme synced to your wallpaper.');
                }
            });
        } catch (value) { if (currentRevision === revision) { error(value, manual); if (bootstrap) { welcome.update('failed'); } } }
        finally { if (currentRevision === revision) { busy = false; updateStatus(); } }
    };
    const schedule = (preferences = false) => {
        if (debounce) { clearTimeout(debounce); }
        debounce = setTimeout(() => { void sync(false, false, preferences); }, 500);
    };
    const stop = () => {
        monitor?.dispose(); monitor = undefined;
        if (timer) { clearInterval(timer); timer = undefined; }
        if (debounce) { clearTimeout(debounce); debounce = undefined; }
    };
    const configureMonitoring = () => {
        stop();
        monitorFallback = !provider.watch;
        updateStatus();
        if (!automaticEnabled()) { return; }
        let monitorFailed = false;
        monitor = provider.watch?.(schedule, value => {
            output.appendLine(`Event monitor failed; periodic checks remain active: ${value.message}`);
            monitorFailed = true; monitorFallback = true; updateStatus();
            if (timer) { clearInterval(timer); timer = setInterval(schedule, 30000); }
        });
        timer = setInterval(schedule, monitor && !monitorFailed ? provider.pollIntervalMs ?? 30000 : 30000);
        schedule();
    };
    const openPreview = async () => {
        if (previewOpening || disposed) { return; }
        previewOpening = true;
        await preview?.cancel();
        cancel();
        await writes;
        if (disposed) { previewOpening = false; return; }
        let source: Awaited<ReturnType<typeof read>> | undefined;
        let variants: PreviewVariants | undefined;
        const picker = createPreviewPicker({
            application, enqueue: serialized, error: value => error(value, true),
            generate: (swatches, rule, mode, primary, signal, style, borders, tint) => runVariant(workerPath, swatches, rule, mode, primary, signal, style, borders, tint),
            prepare: async signal => {
                source = await read(followsWallpaper() || !snapshots.read());
                if (signal.aborted) { throw new Cancelled(); }
                // Selecting a contributed theme does not update our appearance preference.
                // Keep rule/primary previews in the currently visible mode until explicitly toggled.
                const appearance = application.active === themeNames.light ? 'light' : application.active === themeNames.dark ? 'dark' : source.appearance;
                variants = await runPreviews(workerPath, cached?.signature === source.signature ? { swatches: cached.result.swatches } : { path: source.path, swatches: source.swatches }, signal, source.primaries, source.syntaxStyle, undefined, source.borderContrast, source.tints);
                return { variants, harmony: source.harmony, appearance, primaries: source.primaries, syntaxStyle: source.syntaxStyle, borderContrast: source.borderContrast };
            },
        });
        preview = picker; previewOpening = false;
        const choice = await picker.closed;
        if (preview === picker) { preview = undefined; }
        if (disposed) { return; }
        if (choice && source && variants) {
            try {
                await wallpaperPrimaries.remember(source.sourceSignature);
                await snapshots.remember({ wallpaper: source.wallpaper, sourceSignature: source.sourceSignature, swatches: variants[choice.harmony][choice.appearance].swatches });
            }
            catch (value) { error(value, true); }
            signature = ''; cached = undefined;
            output.appendLine(`Kept ${choice.appearance} ${choice.harmony} wallpaper preview`);
        }
        configureMonitoring();
    };
    const previewStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
    previewStatus.text = '$(symbol-color) Borrowed Light';
    previewStatus.tooltip = 'Borrowed Light: Preview color rules, primary hues, syntax colors, and light/dark appearances';
    previewStatus.command = 'borrowed-light.preview';
    previewStatus.show();
    const wallpaperStatus = vscode.window.createStatusBarItem('borrowedLight.wallpaper', vscode.StatusBarAlignment.Right, 9);
    const appearanceStatus = vscode.window.createStatusBarItem('borrowedLight.appearance', vscode.StatusBarAlignment.Right, 8);
    wallpaperStatus.name = 'Borrowed Light Wallpaper Sync';
    appearanceStatus.name = 'Borrowed Light System Appearance';
    wallpaperStatus.command = 'borrowed-light.toggleAutoSync';
    appearanceStatus.command = 'borrowed-light.toggleDesktopAppearance';
    updateStatus = () => {
        welcome.syncing(
            syncIndicatorState(followsWallpaper(), application.ownedThemeActive, busy, lastError),
            syncIndicatorState(followsAppearance(), application.ownedThemeActive, busy, lastError),
        );
        for (const [item, label, icon, enabled] of [
            [wallpaperStatus, 'Wallpaper', 'file-media', followsWallpaper()],
            [appearanceStatus, 'System', 'color-mode', followsAppearance()],
        ] as const) {
            const state = syncIndicatorState(enabled, application.ownedThemeActive, busy, lastError);
            item.text = `$(${state === 'Syncing' ? 'sync~spin' : state === 'Error' ? 'warning' : icon}) ${label}: ${state}`;
            item.tooltip = `Borrowed Light ${label.toLowerCase()} sync: ${state}. Click to toggle.\n` +
                (state === 'Paused' ? 'Select a Borrowed Light theme or run Sync to resume.' : state === 'Error' ? lastError :
                    label === 'System' && enabled && !followsWallpaper() ? 'Uses your last synced wallpaper palette.' : '') +
                (enabled && monitorFallback ? '\nPeriodic checks are active (30-second polling fallback).' : '');
            item.accessibilityInformation = { label: `Borrowed Light ${label} sync ${state}` };
            item.show();
        }
    };
    updateStatus();
    context.subscriptions.push(output, welcome, wallpaperStatus, appearanceStatus,
        vscode.commands.registerCommand('borrowed-light.welcome', () => welcome.show()),
        previewStatus,
        vscode.commands.registerCommand('borrowed-light.preview', openPreview),
        vscode.commands.registerCommand('borrowed-light.sync', async () => { await preview?.cancel(); await sync(true); }),
        vscode.commands.registerCommand('borrowed-light.toggleAutoSync', async () => {
            await preview?.cancel();
            try {
                await serialized(async () => {
                    const enabled = !settings().get<boolean>('autoSync', true);
                    await settings().update('autoSync', enabled, vscode.ConfigurationTarget.Global);
                    void vscode.window.showInformationMessage(enabled
                        ? `Automatic wallpaper sync enabled.${application.ownedThemeActive ? '' : ' Run Sync Theme from Wallpaper to select Borrowed Light.'}`
                        : 'Automatic wallpaper sync disabled.');
                });
            } catch (value) { error(value, true); }
        }),
        vscode.commands.registerCommand('borrowed-light.toggleDesktopAppearance', async () => {
            await preview?.cancel();
            try {
                await serialized(async () => {
                    const following = settings().get<string>('appearance', 'desktop') !== 'desktop';
                    // Turning following off freezes the currently visible appearance.
                    const light = application.active === themeNames.light || (application.active !== themeNames.dark &&
                        [vscode.ColorThemeKind.Light, vscode.ColorThemeKind.HighContrastLight].includes(vscode.window.activeColorTheme.kind));
                    await settings().update('appearance', following ? 'desktop' : light ? 'light' : 'dark', vscode.ConfigurationTarget.Global);
                    void vscode.window.showInformationMessage(following
                        ? `Following desktop light/dark appearance.${followsWallpaper() ? '' : ' Using the last synced wallpaper palette.'}`
                        : `Desktop appearance following disabled. Keeping ${light ? 'light' : 'dark'} appearance.`);
                });
            } catch (value) { error(value, true); }
        }),
        vscode.commands.registerCommand('borrowed-light.report', async () => {
            await preview?.cancel();
            const reportAbort = new AbortController();
            reportWorkers.add(reportAbort);
            try {
                const source = await read(followsWallpaper() || !snapshots.read());
                const result = cached?.signature === source.signature ? cached.result : await generate(source, reportAbort.signal);
                if (disposed) { return; }
                cached = { signature: source.signature, result };
                const panel = vscode.window.createWebviewPanel('borrowedLightReport', 'Borrowed Light: Palette & Contrast', vscode.ViewColumn.Beside, { enableScripts: false, localResourceRoots: [] });
                context.subscriptions.push(panel);
                panel.webview.html = reportHtml(result, source.wallpaper, source.harmony, application.overrideWarnings(result.theme), application.configuredColors(result.theme));
            } catch (value) { error(value, true); }
            finally { reportWorkers.delete(reportAbort); }
        }),
        vscode.commands.registerCommand('borrowed-light.restore', async () => {
            await preview?.cancel();
            cancel(); stop();
            try {
                await serialized(async () => {
                    await settings().update('autoSync', false, vscode.ConfigurationTarget.Global);
                    const mode = application.active === themeNames.light ? 'light' : 'dark';
                    await settings().update('appearance', mode, vscode.ConfigurationTarget.Global);
                    await application.restore();
                    signature = '';
                });
                void vscode.window.showInformationMessage('Previous theme restored. Wallpaper and system appearance syncing are off.');
            } catch (value) { error(value, true); }
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('borrowed-light')) {
                cancel(); signature = '';
                if (event.affectsConfiguration('borrowed-light.platformProvider')) {
                    stop();
                    reportWorkers.forEach(worker => worker.abort());
                    const currentProviderRevision = ++providerRevision;
                    providerUpdate = (async () => {
                        await preview?.cancel();
                        // Guard against rapid preference changes or disposal while probing helpers.
                        const current = settings().get('platformProvider', 'auto');
                        const replacement = await selectProvider(platform, current);
                        if (disposed || currentProviderRevision !== providerRevision || settings().get('platformProvider', 'auto') !== current) { return; }
                        provider = replacement; cached = undefined;
                        output.appendLine(`Wallpaper provider: ${provider.id}`);
                        configureMonitoring();
                    })().catch(value => error(value, false));
                } else {
                    const tintChanged = ['backgroundTintLight', 'backgroundTintDark'].some(key => event.affectsConfiguration(`borrowed-light.${key}`));
                    if (tintChanged) { void preview?.cancel(); }
                    configureMonitoring();
                    // Explicit visual preferences still work on the frozen palette when both
                    // desktop switches are off. Desktop notifications never take this path.
                    const visualPreference = ['backgroundTintLight', 'backgroundTintDark', 'harmony', 'primaryDark', 'primaryLight', 'syntaxStyle', 'borderContrast', 'appearance']
                        .some(key => event.affectsConfiguration(`borrowed-light.${key}`));
                    if (!automaticEnabled() && application.ownedThemeActive && snapshots.read() && visualPreference) { schedule(true); }
                }
            }
            else if (event.affectsConfiguration('workbench.colorTheme')) {
                updateStatus();
                if (!application.ownedThemeActive) { cancel(); void preview?.cancel(); }
                else { schedule(); }
            }
        }),
        { dispose: () => { disposed = true; cancel(); stop(); reportWorkers.forEach(worker => worker.abort()); void preview?.cancel(); } },
    );
    if (installation === 'fresh') {
        welcome.update('pending'); welcome.show();
        await sync(false, true);
        welcome.finishSetup(application.ownedThemeActive && !!snapshots.read());
    }
    configureMonitoring();
}

export function deactivate(): void { /* Context disposes monitors and timers. Applied theme persists. */ }
