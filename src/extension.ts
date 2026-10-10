import * as vscode from 'vscode';
import { stat } from 'node:fs/promises';
import { ThemeApplication } from './application';
import { Appearance, harmonies, Harmony, PaletteResult, PreviewVariants, Wallpaper, PrimaryChoices } from './model';
import { Cancelled, runPipeline, runPreviews, runVariant } from './pipeline';
import { isPrimaryChoice } from './primary';
import { createPreviewPicker, PreviewPicker } from './preview';
import { selectProvider, wallpaperPath } from './providers';
import { reportHtml } from './report';
import { themeNames } from './theme';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Wallpaper Paste');
    const provider = await selectProvider();
    const application = new ThemeApplication(context.globalState);
    try { await application.recoverPreview(); } catch (value) { output.appendLine(`Could not restore an interrupted preview: ${String(value)}`); }
    const workerPath = context.asAbsolutePath('dist/palette-worker.js');
    let disposed = false, revision = 0, signature = '', lastError = '';
    let cached: { signature: string; result: PaletteResult } | undefined;
    let abort: AbortController | undefined;
    let monitor: { dispose(): void } | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let writes = Promise.resolve();
    let preview: PreviewPicker | undefined;
    let previewOpening = false;
    const reportWorkers = new Set<AbortController>();
    const settings = () => vscode.workspace.getConfiguration('wallpaper-paste');
    const serialized = (action: () => Promise<void>): Promise<void> => {
        const next = writes.then(action);
        writes = next.catch(() => {});
        return next;
    };
    const cancel = () => { revision++; abort?.abort(); };
    const error = (value: unknown, manual: boolean) => {
        if (value instanceof Cancelled) { return; }
        const message = value instanceof Error ? value.message : String(value);
        if (manual || message !== lastError) { output.appendLine(message); }
        lastError = message;
        if (manual) { void vscode.window.showErrorMessage(`Wallpaper Paste: ${message}`); }
    };
    const read = async (): Promise<{ wallpaper: Wallpaper; path: string; harmony: Harmony; appearance: Appearance; signature: string; sourceSignature: string; primaries: PrimaryChoices }> => {
        const config = settings();
        const harmony = config.get<Harmony>('harmony', 'analogous');
        if (!harmonies.includes(harmony)) { throw new Error('Unknown harmony setting'); }
        const primaries: PrimaryChoices = { dark: config.get('primaryDark', 'automatic'), light: config.get('primaryLight', 'automatic') };
        if (!isPrimaryChoice(primaries.dark) || !isPrimaryChoice(primaries.light)) { throw new Error('Unknown primary color setting'); }
        const requested = config.get<string>('appearance', 'dark');
        if (!['dark', 'light', 'desktop'].includes(requested)) { throw new Error('Unknown appearance setting'); }
        const wallpaper = await provider.current();
        const appearance = requested === 'desktop' ? wallpaper.appearance : requested as Appearance;
        const path = wallpaperPath(wallpaper.uri), metadata = await stat(path);
        const sourceSignature = JSON.stringify([wallpaper.uri, metadata.size, metadata.mtimeMs, metadata.ctimeMs, metadata.ino]);
        return { wallpaper, path, harmony, appearance, primaries, sourceSignature, signature: JSON.stringify([sourceSignature, harmony, appearance, primaries]) };
    };
    const sync = async (manual: boolean): Promise<void> => {
        if (disposed || preview || previewOpening || (!manual && (!settings().get<boolean>('autoSync') || !application.ownedThemeActive))) { return; }
        cancel();
        const currentRevision = revision;
        abort = new AbortController();
        const signal = abort.signal;
        try {
            const source = await read();
            if (currentRevision !== revision || disposed) { return; }
            if (!manual && source.signature === signature) { return; }
            const result = await runPipeline(workerPath, source.path, source.harmony, source.appearance, signal, source.primaries[source.appearance]);
            if (result.theme.checks.some(check => check.ratio < check.minimum)) { throw new Error('Generated theme failed its contrast checks'); }
            if (currentRevision === revision) { cached = { signature: source.signature, result }; }
            await serialized(async () => {
                if (currentRevision !== revision || disposed || (!manual && !application.ownedThemeActive)) { return; }
                const applied = await application.apply(result.theme, () => currentRevision === revision && !disposed && (manual || application.ownedThemeActive));
                if (!applied) { return; }
                signature = source.signature; lastError = '';
                output.appendLine(`Applied ${result.theme.appearance} ${source.harmony} theme from ${source.wallpaper.uri}`);
                if (manual) {
                    const warnings = application.overrideWarnings(result.theme);
                    if (warnings.length) { output.appendLine(warnings.join('\n')); }
                    void vscode.window.showInformationMessage(warnings.length ? 'Wallpaper theme generated. Some settings may override it; see the contrast report.' : 'Theme synced to your wallpaper.');
                }
            });
        } catch (value) { if (currentRevision === revision) { error(value, manual); } }
    };
    const schedule = () => {
        if (debounce) { clearTimeout(debounce); }
        debounce = setTimeout(() => { void sync(false); }, 500);
    };
    const stop = () => {
        monitor?.dispose(); monitor = undefined;
        if (timer) { clearInterval(timer); timer = undefined; }
        if (debounce) { clearTimeout(debounce); debounce = undefined; }
    };
    const configureMonitoring = () => {
        stop();
        if (!settings().get<boolean>('autoSync')) { return; }
        monitor = provider.watch?.(schedule, value => error(value, false));
        timer = setInterval(schedule, 30000);
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
            generate: (swatches, rule, mode, primary, signal) => runVariant(workerPath, swatches, rule, mode, primary, signal),
            prepare: async signal => {
                source = await read();
                if (signal.aborted) { throw new Cancelled(); }
                // Selecting a contributed theme does not update our appearance preference.
                // Keep rule/primary previews in the currently visible mode until explicitly toggled.
                const appearance = application.active === themeNames.light ? 'light' : application.active === themeNames.dark ? 'dark' : source.appearance;
                variants = await runPreviews(workerPath, cached?.signature === source.signature ? { swatches: cached.result.swatches } : { path: source.path }, signal, source.primaries);
                return { variants, harmony: source.harmony, appearance, primaries: source.primaries };
            },
        });
        preview = picker; previewOpening = false;
        const choice = await picker.closed;
        if (preview === picker) { preview = undefined; }
        if (disposed) { return; }
        if (choice && source && variants) {
            signature = ''; cached = undefined;
            output.appendLine(`Kept ${choice.appearance} ${choice.harmony} wallpaper preview`);
        }
        configureMonitoring();
    };
    const previewStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
    previewStatus.text = '$(symbol-color) Wallpaper';
    previewStatus.tooltip = 'Preview wallpaper color rules and light/dark appearances';
    previewStatus.command = 'wallpaper-paste.preview';
    previewStatus.show();
    context.subscriptions.push(output,
        previewStatus,
        vscode.commands.registerCommand('wallpaper-paste.preview', openPreview),
        vscode.commands.registerCommand('wallpaper-paste.sync', async () => { await preview?.cancel(); await sync(true); }),
        vscode.commands.registerCommand('wallpaper-paste.report', async () => {
            await preview?.cancel();
            const reportAbort = new AbortController();
            reportWorkers.add(reportAbort);
            try {
                const source = await read();
                const result = cached?.signature === source.signature ? cached.result : await runPipeline(workerPath, source.path, source.harmony, source.appearance, reportAbort.signal, source.primaries[source.appearance]);
                if (disposed) { return; }
                cached = { signature: source.signature, result };
                const panel = vscode.window.createWebviewPanel('wallpaperPasteReport', 'Wallpaper Palette & Contrast', vscode.ViewColumn.Beside, { enableScripts: false, localResourceRoots: [] });
                context.subscriptions.push(panel);
                panel.webview.html = reportHtml(result, source.wallpaper, source.harmony, application.overrideWarnings(result.theme), application.configuredColors(result.theme));
            } catch (value) { error(value, true); }
            finally { reportWorkers.delete(reportAbort); }
        }),
        vscode.commands.registerCommand('wallpaper-paste.restore', async () => {
            await preview?.cancel();
            cancel(); stop();
            try {
                await serialized(async () => {
                    await settings().update('autoSync', false, vscode.ConfigurationTarget.Global);
                    await application.restore();
                    signature = '';
                });
                void vscode.window.showInformationMessage('Previous theme restored. Automatic wallpaper sync is off.');
            } catch (value) { error(value, true); }
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('wallpaper-paste')) { cancel(); signature = ''; configureMonitoring(); }
            else if (event.affectsConfiguration('workbench.colorTheme')) {
                if (!application.ownedThemeActive) { cancel(); void preview?.cancel(); }
                else { schedule(); }
            }
        }),
        { dispose: () => { disposed = true; cancel(); stop(); reportWorkers.forEach(worker => worker.abort()); void preview?.cancel(); } },
    );
    configureMonitoring();
}

export function deactivate(): void { /* Context disposes monitors and timers. Applied theme persists. */ }
