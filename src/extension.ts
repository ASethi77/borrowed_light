import * as vscode from 'vscode';
import { stat } from 'node:fs/promises';
import { ThemeApplication } from './application';
import { Appearance, harmonies, Harmony, PaletteResult, Wallpaper } from './model';
import { Cancelled, runPipeline } from './pipeline';
import { selectProvider, wallpaperPath } from './providers';
import { reportHtml } from './report';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Wallpaper Paste');
    const provider = await selectProvider();
    const application = new ThemeApplication(context.globalState);
    const workerPath = context.asAbsolutePath('dist/palette-worker.js');
    let disposed = false, revision = 0, signature = '', lastError = '';
    let cached: { signature: string; result: PaletteResult } | undefined;
    let abort: AbortController | undefined;
    let monitor: { dispose(): void } | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let writes = Promise.resolve();
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
    const read = async (): Promise<{ wallpaper: Wallpaper; path: string; harmony: Harmony; appearance: Appearance; signature: string }> => {
        const config = settings();
        const harmony = config.get<Harmony>('harmony', 'analogous');
        if (!harmonies.includes(harmony)) { throw new Error('Unknown harmony setting'); }
        const requested = config.get<string>('appearance', 'dark');
        if (!['dark', 'light', 'desktop'].includes(requested)) { throw new Error('Unknown appearance setting'); }
        const wallpaper = await provider.current();
        const appearance = requested === 'desktop' ? wallpaper.appearance : requested as Appearance;
        const path = wallpaperPath(wallpaper.uri), metadata = await stat(path);
        return { wallpaper, path, harmony, appearance, signature: JSON.stringify([wallpaper.uri, metadata.size, metadata.mtimeMs, metadata.ctimeMs, metadata.ino, harmony, appearance]) };
    };
    const sync = async (manual: boolean): Promise<void> => {
        if (disposed || (!manual && (!settings().get<boolean>('autoSync') || !application.ownedThemeActive))) { return; }
        cancel();
        const currentRevision = revision;
        abort = new AbortController();
        const signal = abort.signal;
        try {
            const source = await read();
            if (currentRevision !== revision || disposed) { return; }
            if (!manual && source.signature === signature) { return; }
            const result = await runPipeline(workerPath, source.path, source.harmony, source.appearance, signal);
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
    context.subscriptions.push(output,
        vscode.commands.registerCommand('wallpaper-paste.sync', () => sync(true)),
        vscode.commands.registerCommand('wallpaper-paste.report', async () => {
            const reportAbort = new AbortController();
            reportWorkers.add(reportAbort);
            try {
                const source = await read();
                const result = cached?.signature === source.signature ? cached.result : await runPipeline(workerPath, source.path, source.harmony, source.appearance, reportAbort.signal);
                if (disposed) { return; }
                cached = { signature: source.signature, result };
                const panel = vscode.window.createWebviewPanel('wallpaperPasteReport', 'Wallpaper Palette & Contrast', vscode.ViewColumn.Beside, { enableScripts: false, localResourceRoots: [] });
                context.subscriptions.push(panel);
                panel.webview.html = reportHtml(result, source.wallpaper, source.harmony, application.overrideWarnings(result.theme), application.configuredColors(result.theme));
            } catch (value) { error(value, true); }
            finally { reportWorkers.delete(reportAbort); }
        }),
        vscode.commands.registerCommand('wallpaper-paste.restore', async () => {
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
                if (!application.ownedThemeActive) { cancel(); }
                else { schedule(); }
            }
        }),
        { dispose: () => { disposed = true; cancel(); stop(); reportWorkers.forEach(worker => worker.abort()); } },
    );
    configureMonitoring();
}

export function deactivate(): void { /* Context disposes monitors and timers. Applied theme persists. */ }
