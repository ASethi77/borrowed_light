import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { Appearance, PaletteResult, Swatch } from '../../model';
import { themeNames } from '../../color/theme';
import { WallpaperProvider } from '../../platform/contracts';
import { wallpaperUri } from '../../image/source';
import { installationKey, installationKind, WallpaperSnapshots, syncIndicatorState } from '../../sync_state';
import { parseHexColorCode } from '../../color/code';

class Memory {
    constructor(readonly values: Record<string, unknown> = {}) {}
    keys(): string[] { return Object.keys(this.values); }
    get<T>(key: string): T | undefined { return this.values[key] as T | undefined; }
    async update(key: string, value: unknown): Promise<void> { this.values[key] = structuredClone(value); }
}
const green: Swatch[] = [{ hex: parseHexColorCode('#229944'), weight: 1 }];
const blue: Swatch[] = [{ hex: parseHexColorCode('#2244bb'), weight: 1 }];

test('installation detection preserves prior state/preferences and identifies fresh profiles', () => {
    assert.equal(installationKind(new Memory(), false), 'fresh');
    assert.equal(installationKind(new Memory(), true), 'existing');
    assert.equal(installationKind(new Memory({ 'themeOwnership.v1': {} }), false), 'existing');
    assert.equal(installationKind(new Memory({ [installationKey]: true }), false), 'initialized');
});
test('persisted snapshots survive reload and reject corrupt/unbranded color data', async () => {
    const state = new Memory();
    const snapshot = { wallpaper: { uri: 'file:///removed.png', appearance: 'light' as const, provider: 'test' }, sourceSignature: 'source', swatches: green };
    await new WallpaperSnapshots(state).remember(snapshot);
    assert.deepEqual(new WallpaperSnapshots(state).read(), snapshot);
    state.values['wallpaperSnapshot.v1'] = { ...snapshot, swatches: [{ hex: 'red', weight: 1 }] };
    assert.equal(new WallpaperSnapshots(state).read(), undefined);
});
test('indicators distinguish independently disabled, working, paused and failed features', () => {
    assert.equal(syncIndicatorState(false, true, false, ''), 'Off');
    assert.equal(syncIndicatorState(true, true, false, ''), 'On');
    assert.equal(syncIndicatorState(true, false, false, ''), 'Paused');
    assert.equal(syncIndicatorState(true, false, true, ''), 'Syncing');
    assert.equal(syncIndicatorState(true, false, false, 'Cannot read wallpaper'), 'Error');
});

/** Exercise the real activation coordinator with deterministic desktop/VS Code adapters.
 * This covers lifecycle transitions on every CI OS without touching the user's desktop.
 * The actual ThemeApplication, worker, and UI APIs have separate extension-host tests.
 */
async function harness(state = new Memory(), explicit: Record<string, unknown> = {}, fail = false, options: { mode?: Appearance; beforeGenerate?: (update: (key: string, value: unknown) => Promise<void>) => Promise<void> } = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-lifecycle-'));
    const imagePath = join(directory, 'wallpaper.png');
    await writeFile(imagePath, 'fixture');
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    const defaults = Object.fromEntries(Object.entries(manifest.contributes.configuration.properties as Record<string, { default: unknown }>).map(([key, value]) => [key, value.default]));
    const values: Record<string, unknown> = { ...explicit };
    const listeners = new Set<(event: { affectsConfiguration(key: string): boolean }) => void>();
    const timers = new Map<number, () => void>();
    const timeoutDurations = new Map<number, number>();
    const notifications: { title: string; location: number; cancellable: boolean; closed: boolean }[] = [];
    const subscriptions: { dispose(): void }[] = [];
    const commands = new Map<string, () => Promise<void>>();
    const statuses: { text: string; tooltip?: string; name?: string; command?: string }[] = [];
    const panels: { webview: { html: string; messages: { state: string; sync: { wallpaper: string; appearance: string } }[] }; options: unknown; disposed: boolean }[] = [];
    const applied: PaletteResult['theme'][] = [];
    const tintCalls: { appearance: Appearance; tint?: string }[] = [];
    let monitorFailure = (_error: Error) => {};
    let mode: Appearance = options.mode ?? 'light', swatches = green, currentCalls = 0, appearanceCalls = 0, watchCallback = () => {}, timerID = 0;
    const disposable = () => ({ dispose() {} });
    const configuration = (prefix = '') => ({
        get: (key: string, fallback?: unknown) => values[prefix + key] ?? defaults[prefix + key] ?? fallback,
        inspect: (key: string) => ({ globalValue: values[prefix + key] }),
        update: async (key: string, value: unknown) => {
            const full = prefix + key;
            if (value === undefined) { delete values[full]; } else { values[full] = value; }
            for (const listener of listeners) { listener({ affectsConfiguration: query => full === query || full.startsWith(query + '.') }); }
        },
    });
    const provider: WallpaperProvider = {
        id: 'test', available: async () => true,
        current: async () => { currentCalls++; if (fail) { throw new Error('Unavailable wallpaper'); } return { uri: wallpaperUri(imagePath), appearance: mode, provider: 'test' }; },
        appearance: async () => { appearanceCalls++; return mode; },
        watch: (changed, failed) => { watchCallback = changed; monitorFailure = failed; return disposable(); },
    };
    const fakeVscode = {
        Uri: { joinPath: (base: string, ...parts: string[]) => [base, ...parts].join('/') },
        ProgressLocation: { Notification: 15 },
        ConfigurationTarget: { Global: 1 }, StatusBarAlignment: { Right: 1 }, ViewColumn: { Active: 1 }, ColorThemeKind: { Light: 1, HighContrastLight: 4 },
        workspace: { getConfiguration: (section?: string) => configuration(section ? section + '.' : ''), onDidChangeConfiguration: (listener: typeof listeners extends Set<infer T> ? T : never) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; } },
        window: {
            activeColorTheme: { kind: 1 },
            createOutputChannel: () => ({ ...disposable(), appendLine() {} }),
            showInformationMessage() {}, showErrorMessage() {},
            withProgress: (options: { title: string; location: number; cancellable: boolean }, task: () => Promise<void>) => {
                const notification = { ...options, closed: false };
                notifications.push(notification);
                return task().then(() => { notification.closed = true; });
            },
            createStatusBarItem: () => { const item = { ...disposable(), text: '', show() {} }; statuses.push(item); return item; },
            createWebviewPanel: (_type: string, _title: string, _column: unknown, options: unknown) => {
                const panel = { webview: { html: '', messages: [] as (typeof panels)[number]['webview']['messages'], cspSource: 'https://webview.test', asWebviewUri: (uri: string) => uri, onDidReceiveMessage: disposable, postMessage(message: (typeof panels)[number]['webview']['messages'][number]) { this.messages.push(message); } }, options, disposed: false, reveal() {}, onDidDispose: disposable, dispose() { this.disposed = true; } };
                panels.push(panel); return panel;
            },
        },
        commands: { registerCommand: (name: string, command: () => Promise<void>) => { commands.set(name, command); return disposable(); } },
    };
    class Application {
        get active(): string { return String(values['workbench.colorTheme'] ?? 'Default Dark Modern'); }
        get ownedThemeActive(): boolean { return Object.values(themeNames).includes(this.active); }
        async recoverPreview() {}
        async apply(theme: PaletteResult['theme'], maySelect: () => boolean) { if (!maySelect()) { return false; } applied.push(theme); await configuration().update('workbench.colorTheme', themeNames[theme.appearance]); return true; }
        overrideWarnings() { return []; }
        async restore() { await configuration().update('workbench.colorTheme', 'Default Dark Modern'); }
    }
    const result = (colors: Swatch[], appearance: Appearance) => ({ swatches: colors, theme: { appearance, colors: { 'editor.background': colors[0].hex }, checks: [] } });
    const pipelines = {
        Cancelled: class extends Error {},
        runPipeline: async (_worker: string, _path: string, _harmony: unknown, appearance: Appearance, _signal?: unknown, _primary?: unknown, _syntax?: unknown, _decoder?: unknown, _borders?: unknown, tint?: string) => {
            await options.beforeGenerate?.(configuration().update);
            tintCalls.push({ appearance, tint }); return result(swatches, appearance);
        },
        runVariant: async (_worker: string, colors: Swatch[], _harmony: unknown, appearance: Appearance, _primary?: unknown, _signal?: unknown, _syntax?: unknown, _borders?: unknown, tint?: string) => {
            await options.beforeGenerate?.(configuration().update);
            tintCalls.push({ appearance, tint }); return result(colors, appearance);
        },
    };
    const load = (filename: string): { activate(context: unknown): Promise<void> } => {
        const localRequire = createRequire(filename);
        const module = { exports: {} };
        const requireMock = (name: string): unknown => {
            if (name === 'vscode') { return fakeVscode; }
            if (name === './application') { return { ThemeApplication: Application }; }
            if (name === './pipeline') { return pipelines; }
            if (name === './preview') { return {}; }
            if (name === './platform/os_wallpaper') { return { selectProvider: async () => provider }; }
            if (name === './welcome') { return load(join(dirname(filename), 'welcome.js')); }
            return localRequire(name);
        };
        const wrapper = runInNewContext(`(function(require,module,exports){${readFileSync(filename, 'utf8')}\n})`, {
            setTimeout: (callback: () => void, duration: number) => { timers.set(++timerID, callback); timeoutDurations.set(timerID, duration); return timerID; }, clearTimeout: (id: number) => timers.delete(id),
            setInterval: () => ++timerID, clearInterval() {}, AbortController,
        });
        wrapper(requireMock, module, module.exports);
        return module.exports as ReturnType<typeof load>;
    };
    const activation = load(resolve(__dirname, '../../extension.js'));
    await activation.activate({ extensionUri: 'https://webview.test/extension', globalState: state, extension: { packageJSON: manifest }, subscriptions, asAbsolutePath: (path: string) => resolve(path) });
    const flush = async () => {
        const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback());
        for (let attempts = 0; attempts < 30; attempts++) { await new Promise(resolve => setTimeout(resolve, 5)); }
    };
    return {
        state, values, statuses, panels, applied, commands, imagePath, tintCalls, notifications,
        get pendingTimeouts() { return [...timers.keys()].map(id => timeoutDurations.get(id)); },
        failMonitor: () => monitorFailure(new Error('Monitor unavailable')),
        get currentCalls() { return currentCalls; }, get appearanceCalls() { return appearanceCalls; },
        setMode(value: Appearance) { mode = value; watchCallback(); }, setSwatches(value: Swatch[]) { swatches = value; watchCallback(); },
        update: configuration().update, flush,
        async dispose() { for (const subscription of subscriptions.reverse()) { subscription.dispose(); } await rm(directory, { recursive: true, force: true }); },
    };
}

test('confirmation popups expire after five seconds and close on replacement or disposal', async () => {
    const host = await harness();
    try {
        await host.commands.get('borrowed-light.toggleAutoSync')!();
        assert.equal(host.notifications[0].title, 'Automatic wallpaper sync disabled.');
        assert.equal(host.notifications[0].location, 15);
        assert.equal(host.notifications[0].cancellable, false);
        assert.equal(host.notifications[0].closed, false);
        assert.ok(host.pendingTimeouts.includes(5000));

        await host.commands.get('borrowed-light.toggleAutoSync')!();
        assert.equal(host.notifications[0].closed, true);
        assert.equal(host.notifications[1].closed, false);
        assert.match(host.notifications[1].title, /Automatic wallpaper sync enabled/);
        await host.flush();
        assert.equal(host.notifications[1].closed, true);

        await host.commands.get('borrowed-light.toggleDesktopAppearance')!();
        assert.equal(host.notifications[2].closed, false);
    } finally { await host.dispose(); }
    assert.equal(host.notifications[2].closed, true);
    assert.equal(host.pendingTimeouts.length, 0);
});

test('fresh install automatically selects system mode, saves a palette and shows welcome once', async () => {
    const host = await harness();
    try {
        assert.equal(host.applied.length, 1);
        assert.equal(host.values['workbench.colorTheme'], themeNames.light);
        assert.ok(new WallpaperSnapshots(host.state).read());
        assert.equal(host.panels.length, 1);
        assert.equal(host.panels[0].webview.messages.at(-1)?.state, 'ready');
        assert.ok(host.statuses.some(item => item.text.includes('Wallpaper: On')));
        assert.ok(host.statuses.some(item => item.text.includes('System: On')));
        const next = await harness(host.state, host.values);
        try { assert.equal(next.panels.length, 0); assert.equal(next.applied.length, 0); }
        finally { await next.dispose(); }
    } finally { await host.dispose(); }
});
test('upgrade keeps old effective defaults and explicit preferences without selecting a theme', async () => {
    for (const preferences of [{}, { 'borrowed-light.autoSync': true, 'borrowed-light.appearance': 'dark' }]) {
        const host = await harness(new Memory({ 'themeOwnership.v1': {} }), preferences);
        try {
            assert.equal(host.values['borrowed-light.autoSync'], preferences['borrowed-light.autoSync'] ?? false);
            assert.equal(host.applied.length, 0); assert.equal(host.panels.length, 0);
            await host.flush(); assert.equal(host.applied.length, 0);
        } finally { await host.dispose(); }
    }
});
test('failed first sync preserves theme, reports failure, and does not reopen welcome on restart', async () => {
    const host = await harness(new Memory(), {}, true);
    try {
        assert.equal(host.applied.length, 0);
        assert.equal(host.panels[0].webview.messages.at(-1)?.state, 'failed');
        assert.ok(host.statuses.some(item => item.text.includes('Wallpaper: Error')));
        const next = await harness(host.state, host.values, true);
        try { assert.equal(next.panels.length, 0); }
        finally { await next.dispose(); }
    } finally { await host.dispose(); }
});
test('wallpaper and system following are independent, persist across restart and pause for another theme', async () => {
    const host = await harness();
    try {
        // Wallpaper-only: new colors, frozen mode.
        await host.update('borrowed-light.appearance', 'light');
        host.setMode('dark'); host.setSwatches(blue); await host.flush();
        assert.equal(host.applied.at(-1)?.appearance, 'light');
        assert.equal(host.applied.at(-1)?.colors['editor.background'], blue[0].hex);
        // Appearance-only: ignore new wallpaper, including replacement/removal at the same path.
        await host.update('borrowed-light.autoSync', false);
        await host.update('borrowed-light.appearance', 'desktop');
        const calls = host.currentCalls;
        await rm(host.imagePath);
        host.setSwatches(green); host.setMode('dark'); await host.flush();
        assert.equal(host.currentCalls, calls);
        assert.ok(host.appearanceCalls > 0);
        assert.equal(host.applied.at(-1)?.appearance, 'dark');
        assert.equal(host.applied.at(-1)?.colors['editor.background'], blue[0].hex);
        const restart = await harness(host.state, host.values);
        try {
            restart.setMode('light'); await restart.flush();
            assert.equal(restart.currentCalls, 0);
            assert.equal(restart.applied.at(-1)?.appearance, 'light');
            assert.equal(restart.applied.at(-1)?.colors['editor.background'], blue[0].hex);
        } finally { await restart.dispose(); }
        // Both off: desktop changes do nothing.
        await host.update('borrowed-light.appearance', 'dark'); await host.flush();
        const count = host.applied.length;
        host.setMode('light'); host.setSwatches(green); await host.flush();
        assert.equal(host.applied.length, count);
        // Both enabled but a different VS Code theme is selected: remain paused.
        await host.update('workbench.colorTheme', 'Default Dark Modern');
        await host.update('borrowed-light.autoSync', true);
        await host.update('borrowed-light.appearance', 'desktop'); await host.flush();
        assert.equal(host.applied.length, count);
        assert.ok(host.statuses.some(item => item.text.includes('System: Paused')));
    } finally { await host.dispose(); }
});
test('manual sync refreshes a frozen palette and Restore disables both automatic behaviors', async () => {
    const host = await harness();
    try {
        await host.update('borrowed-light.autoSync', false);
        host.setSwatches(blue);
        await host.commands.get('borrowed-light.sync')!();
        assert.equal(new WallpaperSnapshots(host.state).read()?.swatches[0].hex, blue[0].hex);
        await host.commands.get('borrowed-light.restore')!(); await host.flush();
        assert.equal(host.values['borrowed-light.autoSync'], false);
        assert.notEqual(host.values['borrowed-light.appearance'], 'desktop');
        assert.equal(host.values['workbench.colorTheme'], 'Default Dark Modern');
    } finally { await host.dispose(); }
});

test('explicit tint changes update a frozen theme and retain the other appearance preference', async () => {
    const host = await harness();
    try {
        await host.update('borrowed-light.autoSync', false);
        await host.update('borrowed-light.appearance', 'light'); await host.flush();
        const calls = host.currentCalls, count = host.applied.length;
        await host.update('borrowed-light.backgroundTintLight', 'balanced'); await host.flush();
        assert.equal(host.currentCalls, calls, 'a visual setting must not adopt a new wallpaper');
        assert.equal(host.applied.length, count + 1);
        assert.equal(host.tintCalls.at(-1)?.tint, 'balanced');
        assert.equal(host.values['borrowed-light.backgroundTintDark'], undefined);
        await host.update('borrowed-light.appearance', 'dark'); await host.flush();
        assert.equal(host.tintCalls.at(-1)?.tint, 'colorful', 'dark defaults retain their original styling');
    } finally { await host.dispose(); }
});
test('new installation follows a dark system without changing original dark styling', async () => {
    const host = await harness(new Memory(), {}, false, { mode: 'dark' });
    try {
        assert.equal(host.applied.at(-1)?.appearance, 'dark');
        assert.equal(host.tintCalls.at(-1)?.tint, 'colorful');
    } finally { await host.dispose(); }
});
test('interrupted first setup respects a different selected theme and finishes welcome progress', async () => {
    const host = await harness(new Memory(), {}, false, {
        beforeGenerate: async update => { await update('workbench.colorTheme', 'Solarized Light'); },
    });
    try {
        assert.equal(host.values['workbench.colorTheme'], 'Solarized Light');
        assert.equal(host.applied.length, 0);
        assert.equal(host.panels[0].webview.messages.at(-1)?.state, 'paused');
        await host.flush(); assert.equal(host.applied.length, 0);
    } finally { await host.dispose(); }
});
test('monitor failure reports polling fallback while both independent controls remain active', async () => {
    const host = await harness();
    try {
        host.failMonitor(); await host.flush();
        for (const label of ['Wallpaper', 'System']) {
            const item = host.statuses.find(item => item.text.includes(`${label}:`))!;
            assert.match(item.text, /On$/);
            assert.match(item.tooltip!, /30-second polling fallback/);
        }
    } finally { await host.dispose(); }
});
test('welcome offers restricted command links and reuses the panel', async () => {
    const host = await harness();
    try {
        const options = host.panels[0].options as { enableScripts: boolean; enableCommandUris: string[]; localResourceRoots: unknown[] };
        assert.equal(options.enableScripts, true);
        assert.ok(options.enableCommandUris.includes('borrowed-light.preview'));
        assert.ok(!options.enableCommandUris.includes('workbench.action.terminal.new'));
        assert.equal(options.localResourceRoots.length, 1);
        assert.match(String(options.localResourceRoots[0]), /docs\/demo$/);
        assert.match(host.panels[0].webview.html, /Content-Security-Policy/);
        const links = [...host.panels[0].webview.html.matchAll(/href="(command:[^"]+)"/g)].map(match => decodeURIComponent(match[1]));
        assert.ok(links.some(link => link.includes('borrowed-light.backgroundTintLight')));
        assert.ok(links.some(link => link.includes('borrowed-light.backgroundTintDark')));
        await host.commands.get('borrowed-light.welcome')!();
        assert.equal(host.panels.length, 1);
    } finally { await host.dispose(); }
});

test('welcome embeds ordered demos and updates independent statuses without reloading video', async () => {
    const host = await harness();
    try {
        const webview = host.panels[0].webview;
        const html = webview.html;
        const videos = [...html.matchAll(/<source src="([^"]+)"/g)].map(match => match[1].split('/').at(-1));
        assert.deepEqual(videos, ['system_syncing_demo.mp4', 'background_hue_selection.mp4', 'syntax_highlighting_options.mp4']);
        assert.match(html, /media-src https:\/\/webview.test/);
        assert.match(html, /script-src 'nonce-[a-f0-9]+'/);
        const elements = Object.fromEntries(['welcome-message', 'wallpaper-status', 'appearance-status'].map(id => [id, { textContent: '', dataset: { state: '' } }]));
        let receive!: (event: { data: unknown }) => void;
        let ready = false;
        const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)![1];
        runInNewContext(script, {
            window: { addEventListener: (_event: string, listener: typeof receive) => { receive = listener; } },
            document: { getElementById: (id: string) => elements[id] },
            acquireVsCodeApi: () => ({ postMessage: (message: { type: string }) => { ready = message.type === 'welcomeReady'; } }),
        });
        assert.ok(ready, 'webview requests latest state after its listener is ready');
        receive({ data: webview.messages.at(-1) });
        assert.equal(elements['wallpaper-status'].textContent, '✓ Synced to desktop');
        assert.equal(elements['appearance-status'].textContent, '✓ Synced to desktop');
        for (const wallpaper of [false, true]) {
            for (const appearance of [false, true]) {
                await host.update('borrowed-light.autoSync', wallpaper);
                await host.update('borrowed-light.appearance', appearance ? 'desktop' : 'light');
                await host.flush();
                receive({ data: webview.messages.at(-1) });
                assert.equal(elements['wallpaper-status'].textContent, wallpaper ? '✓ Synced to desktop' : '✕ Off');
                assert.equal(elements['appearance-status'].textContent, appearance ? '✓ Synced to desktop' : '✕ Off');
                assert.equal(webview.html, html, 'status changes preserve video elements');
            }
        }
        await host.update('workbench.colorTheme', 'Solarized Light');
        receive({ data: webview.messages.at(-1) });
        assert.equal(elements['wallpaper-status'].textContent, '✕ Paused');
        assert.equal(elements['appearance-status'].textContent, '✕ Paused');
    } finally { await host.dispose(); }
});

test('manual Sync supersedes a queued visual refresh during a slow image generation', async () => {
    const options: { beforeGenerate?: (update: (key: string, value: unknown) => Promise<void>) => Promise<void> } = {};
    const host = await harness(new Memory(), {}, false, options);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let generations = 0;
    try {
        await host.update('borrowed-light.autoSync', false);
        await host.update('borrowed-light.appearance', 'dark');
        options.beforeGenerate = async () => { generations++; entered(); await gate; };
        const pending = host.commands.get('borrowed-light.sync')!();
        await started;
        await host.flush();
        assert.equal(generations, 1, 'queued preference timer must not supersede manual generation');
        release(); await pending;
        assert.equal(host.applied.at(-1)?.appearance, 'dark');
    } finally { release(); await host.dispose(); }
});
