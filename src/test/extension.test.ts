import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { ThemeApplication, customizationSections } from '../application';
import { generateTheme, themeNames } from '../theme';
import { Values } from '../ownership';
import { generateVariant, generateVariants } from '../variants';
import { createPreviewPicker } from '../preview';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { runVariant } from '../pipeline';

class Memory implements vscode.Memento {
    private values: Record<string, unknown> = {};
    failAt = 0;
    updates = 0;
    keys(): readonly string[] { return Object.keys(this.values); }
    get<T>(key: string, defaultValue?: T): T | undefined { return (this.values[key] as T | undefined) ?? defaultValue; }
    async update(key: string, value: unknown): Promise<void> {
        if (++this.updates === this.failAt) { throw new Error('Simulated state write failure'); }
        if (value === undefined) { delete this.values[key]; }
        else { this.values[key] = JSON.parse(JSON.stringify(value)); }
    }
}
const palette = ['#5a8cab','#d79e63','#8eb886','#bd88c7','#bf7272'];
suite('Wallpaper Paste extension host', () => {
    const config = () => vscode.workspace.getConfiguration();
    const sections = [...customizationSections, 'workbench.colorTheme', 'wallpaper-paste.autoSync', 'wallpaper-paste.harmony', 'wallpaper-paste.appearance', 'wallpaper-paste.primaryDark', 'wallpaper-paste.primaryLight'];
    let originals: Record<string, unknown>;
    setup(() => {
        originals = Object.fromEntries(sections.map(section => [section, config().inspect(section)?.globalValue]));
    });
    teardown(async () => {
        for (const section of sections) { await config().update(section, originals[section], vscode.ConfigurationTarget.Global); }
    });
    test('extension loads with all four commands and both theme contributions', async () => {
        const extension = vscode.extensions.getExtension('wallpaper-paste-local.wallpaper-paste');
        assert.ok(extension);
        await extension.activate();
        const commands = await vscode.commands.getCommands(true);
        for (const name of ['sync', 'report', 'restore', 'preview']) { assert.ok(commands.includes(`wallpaper-paste.${name}`)); }
        assert.deepEqual(extension.packageJSON.contributes.themes.map((theme: { label: string }) => theme.label), Object.values(themeNames));
    });
    test('live customization merge and restart-safe restoration preserve unrelated settings', async () => {
        const original = { '[Other]': { 'editor.background': '#123456' } };
        await config().update('workbench.colorCustomizations', original, vscode.ConfigurationTarget.Global);
        const previousTheme = config().inspect<string>('workbench.colorTheme')?.globalValue;
        const memory = new Memory(), application = new ThemeApplication(memory);
        await application.apply(generateTheme(palette, 'dark'));
        assert.equal(config().get('workbench.colorTheme'), themeNames.dark);
        assert.deepEqual(config().inspect<Values>('workbench.colorCustomizations')?.globalValue?.['[Other]'], original['[Other]']);
        await application.apply(generateTheme(palette, 'light'));
        const restarted = new ThemeApplication(memory);
        await restarted.restore();
        assert.deepEqual(config().inspect('workbench.colorCustomizations')?.globalValue, original);
        assert.equal(config().inspect('workbench.colorTheme')?.globalValue, previousTheme);
        assert.equal(restarted.ledger, undefined);
    });
    test('restore preserves user-edited generated keys and a subsequently selected theme', async () => {
        await config().update('workbench.colorCustomizations', undefined, vscode.ConfigurationTarget.Global);
        const application = new ThemeApplication(new Memory());
        await application.apply(generateTheme(palette, 'dark'));
        const colors = config().inspect<Values>('workbench.colorCustomizations')!.globalValue!;
        const block = colors['[Wallpaper Paste Dark]'] as Values;
        block['editor.background'] = '#123456';
        await config().update('workbench.colorCustomizations', colors, vscode.ConfigurationTarget.Global);
        await config().update('workbench.colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
        await application.restore();
        assert.equal(config().get('workbench.colorTheme'), 'Default Dark Modern');
        assert.deepEqual(config().inspect('workbench.colorCustomizations')?.globalValue, { '[Wallpaper Paste Dark]': { 'editor.background': '#123456' } });
    });
    test('a failed apply rolls back successful writes and its ownership journal', async () => {
        const memory = new Memory(); memory.failAt = 2;
        const application = new ThemeApplication(memory);
        const before = config().inspect('workbench.colorCustomizations')?.globalValue;
        await assert.rejects(application.apply(generateTheme(palette, 'dark')), /Simulated/);
        assert.deepEqual(config().inspect('workbench.colorCustomizations')?.globalValue, before);
        assert.equal(application.ledger, undefined);
    });
    test('cancel and interrupted preview restore all appearances and the prior ownership ledger', async () => {
        const memory = new Memory(), app = new ThemeApplication(memory);
        await app.apply(generateTheme(palette, 'dark'));
        const before = Object.fromEntries(sections.map(section => [section, config().inspect(section)?.globalValue]));
        const ledger = JSON.parse(JSON.stringify(app.ledger));
        await app.beginPreview();
        await app.apply(generateTheme(palette.slice().reverse(), 'light'));
        await app.apply(generateTheme(palette.slice().reverse(), 'dark'));
        await new ThemeApplication(memory).recoverPreview();
        for (const section of sections) { assert.deepEqual(config().inspect(section)?.globalValue, before[section], section); }
        assert.deepEqual(app.ledger, ledger);
    });
    test('keeping a preview saves rule and appearance and preserves the original restore baseline', async () => {
        const before = Object.fromEntries(customizationSections.map(section => [section, config().inspect(section)?.globalValue]));
        const app = new ThemeApplication(new Memory());
        await app.apply(generateTheme(palette, 'dark'));
        await app.beginPreview();
        await app.apply(generateTheme(palette, 'light'));
        await app.commitPreview('triad', 'light');
        assert.equal(config().get('wallpaper-paste.harmony'), 'triad');
        assert.equal(config().get('wallpaper-paste.appearance'), 'light');
        assert.equal(app.active, themeNames.light);
        await app.restore();
        for (const section of customizationSections) { assert.deepEqual(config().inspect(section)?.globalValue, before[section]); }
    });
    test('cancel preview preserves subsequent manual edits and a separately selected theme', async () => {
        const app = new ThemeApplication(new Memory());
        await app.beginPreview();
        await app.apply(generateTheme(palette, 'light'));
        const colors = config().inspect<Values>('workbench.colorCustomizations')!.globalValue!;
        (colors['[Wallpaper Paste Light]'] as Values)['editor.background'] = '#abcdef';
        await config().update('workbench.colorCustomizations', colors, vscode.ConfigurationTarget.Global);
        await config().update('workbench.colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
        await app.finishPreview(false);
        assert.equal(app.active, 'Default Dark Modern');
        assert.equal((config().inspect<Values>('workbench.colorCustomizations')!.globalValue!['[Wallpaper Paste Light]'] as Values)['editor.background'], '#abcdef');
        assert.equal(app.ledger, undefined);
    });
    test('native picker previews keyboard navigation and Escape restores the starting theme', async () => {
        const app = new ThemeApplication(new Memory());
        const before = Object.fromEntries(sections.map(section => [section, config().inspect(section)?.globalValue]));
        const variants = generateVariants([{ hex: '#2288bb', weight: 1 }]);
        let writes = Promise.resolve();
        const errors: unknown[] = [];
        const picker = createPreviewPicker({
            application: app, prepare: async () => ({ variants, harmony: 'analogous', appearance: 'light' }),
            enqueue: action => { const next = writes.then(action); writes = next.catch(() => {}); return next; },
            error: error => { errors.push(error); },
        });
        const wait = async (predicate: () => boolean) => {
            const deadline = Date.now() + 10000;
            while (!predicate() && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 50)); }
            assert.ok(predicate());
        };
        const colors = () => (config().inspect<Values>('workbench.colorCustomizations')?.globalValue?.['[Wallpaper Paste Light]'] as Values | undefined);
        try {
            await wait(() => app.active === themeNames.light);
            await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
            await wait(() => JSON.stringify(colors()) === JSON.stringify(variants.monochromatic.light.theme.colors));
            picker.cyclePrimary();
            picker.toggleAppearance();
            await wait(() => app.active === themeNames.dark);
            if (process.env.WALLPAPER_PASTE_SCREENSHOT_DIR) {
                await new Promise(resolve => setTimeout(resolve, 500));
                await promisify(execFile)('import', ['-window', 'root', `${process.env.WALLPAPER_PASTE_SCREENSHOT_DIR}/picker.png`]);
            }
            await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
            assert.equal(await picker.closed, undefined);
            assert.deepEqual(errors, []);
            for (const section of sections) { assert.deepEqual(config().inspect(section)?.globalValue, before[section], section); }
        } finally { await picker.cancel(); }
    });
    test('native picker Enter keeps the last navigated rule and appearance', async () => {
        const app = new ThemeApplication(new Memory());
        const variants = generateVariants([{ hex: '#bb4422', weight: 1 }]);
        let writes = Promise.resolve();
        const errors: unknown[] = [];
        const picker = createPreviewPicker({
            application: app, prepare: async () => ({ variants, harmony: 'analogous', appearance: 'dark' }),
            enqueue: action => { const next = writes.then(action); writes = next.catch(() => {}); return next; },
            error: error => { errors.push(error); },
        });
        try {
            const waitFor = async (rule: 'analogous' | 'monochromatic' | 'triad') => {
                const matches = () => app.active === themeNames.dark && JSON.stringify(config().inspect<Values>('workbench.colorCustomizations')?.globalValue?.['[Wallpaper Paste Dark]']) === JSON.stringify(variants[rule].dark.theme.colors);
                const deadline = Date.now() + 10000;
                while (!matches() && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 50)); }
                assert.ok(matches(), `preview reaches ${rule}`);
            };
            await waitFor('analogous');
            await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
            await waitFor('monochromatic');
            await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
            await waitFor('triad');
            // Acceptance waits for pending configuration writes, including the final requested preview.
            await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
            assert.deepEqual(await picker.closed, { harmony: 'triad', appearance: 'dark', primaries: { dark: 'automatic', light: 'automatic' } });
            assert.equal(config().get('wallpaper-paste.harmony'), 'triad');
            assert.equal(config().get('wallpaper-paste.appearance'), 'dark');
            assert.deepEqual(errors, []);
        } finally { await picker.cancel(); await app.restore(); }
    });
    test('primary cycling previews wallpaper highlights and remembers separate light/dark choices', async () => {
        const app = new ThemeApplication(new Memory());
        const swatches = [{ hex: '#229944', weight: 0.7 }, { hex: '#2266cc', weight: 0.15 }, { hex: '#eedd22', weight: 0.1 }, { hex: '#cc3322', weight: 0.05 }];
        const variants = generateVariants(swatches);
        let writes = Promise.resolve();
        const errors: unknown[] = [];
        const picker = createPreviewPicker({
            application: app, prepare: async () => ({ variants, harmony: 'analogous', appearance: 'dark' }),
            enqueue: action => { const next = writes.then(action); writes = next.catch(() => {}); return next; },
            generate: (swatches, rule, mode, primary, signal) => runVariant(join(__dirname, '../../dist/palette-worker.js'), swatches, rule, mode, primary, signal),
            error: error => { errors.push(error); },
        });
        const waitFor = async (mode: 'light' | 'dark', primary: 'automatic' | 'wallpaper-1' | 'wallpaper-2') => {
            const expected = generateVariant(swatches, 'analogous', mode, primary).theme.colors;
            const matches = () => app.active === themeNames[mode] && JSON.stringify(config().inspect<Values>('workbench.colorCustomizations')?.globalValue?.[`[${themeNames[mode]}]`]) === JSON.stringify(expected);
            const deadline = Date.now() + 10000;
            while (!matches() && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 50)); }
            assert.ok(matches(), `${mode}/${primary}`);
        };
        try {
            await waitFor('dark', 'automatic');
            picker.cyclePrimary(); picker.cyclePrimary();
            await waitFor('dark', 'wallpaper-2');
            picker.toggleAppearance();
            await waitFor('light', 'automatic');
            picker.cyclePrimary();
            await waitFor('light', 'wallpaper-1');
            picker.toggleAppearance();
            await waitFor('dark', 'wallpaper-2');
            if (process.env.WALLPAPER_PASTE_SCREENSHOT_DIR) {
                await new Promise(resolve => setTimeout(resolve, 500));
                await promisify(execFile)('import', ['-window', 'root', `${process.env.WALLPAPER_PASTE_SCREENSHOT_DIR}/primary-picker.png`]);
            }
            await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
            assert.deepEqual((await picker.closed)?.primaries, { dark: 'wallpaper-2', light: 'wallpaper-1' });
            assert.equal(config().get('wallpaper-paste.primaryDark'), 'wallpaper-2');
            assert.equal(config().get('wallpaper-paste.primaryLight'), 'wallpaper-1');
            assert.deepEqual(errors, []);
        } finally { await picker.cancel(); await app.restore(); }
    });
});
