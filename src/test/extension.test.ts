import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { ThemeApplication, customizationSections } from '../application';
import { generateTheme, themeNames, themeLabels } from '../theme';
import { Values } from '../ownership';
import { generateVariant, generateVariants } from '../variants';
import { createPreviewPicker } from '../preview';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { runVariant } from '../pipeline';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

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
suite('Borrowed Light extension host', () => {
    const config = () => vscode.workspace.getConfiguration();
    const sections = [...customizationSections, 'workbench.colorTheme', 'borrowed-light.autoSync', 'borrowed-light.harmony', 'borrowed-light.appearance', 'borrowed-light.primaryDark', 'borrowed-light.primaryLight', 'borrowed-light.syntaxStyle'];
    let originals: Record<string, unknown>;
    setup(() => {
        originals = Object.fromEntries(sections.map(section => [section, config().inspect(section)?.globalValue]));
    });
    teardown(async () => {
        for (const section of sections) { await config().update(section, originals[section], vscode.ConfigurationTarget.Global); }
    });
    test('extension loads with all four commands and both theme contributions', async () => {
        const extension = vscode.extensions.getExtension('borrowed-light-local.borrowed-light');
        assert.ok(extension);
        await extension.activate();
        assert.equal(extension.packageJSON.displayName, 'Borrowed Light');
        const commands = await vscode.commands.getCommands(true);
        for (const name of ['sync', 'report', 'restore', 'preview']) { assert.ok(commands.includes(`borrowed-light.${name}`)); }
        assert.deepEqual(extension.packageJSON.contributes.themes.map((theme: { label: string }) => theme.label), Object.values(themeLabels));
        assert.deepEqual(extension.packageJSON.contributes.themes.map((theme: { id: string }) => theme.id), Object.values(themeNames));
        assert.ok(extension.packageJSON.contributes.commands.every((command: { title: string }) => command.title.startsWith('Borrowed Light:')));
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
        const block = colors['[Borrowed Light (Dark)]'] as Values;
        block['editor.background'] = '#123456';
        await config().update('workbench.colorCustomizations', colors, vscode.ConfigurationTarget.Global);
        await config().update('workbench.colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
        await application.restore();
        assert.equal(config().get('workbench.colorTheme'), 'Default Dark Modern');
        assert.deepEqual(config().inspect('workbench.colorCustomizations')?.globalValue, { '[Borrowed Light (Dark)]': { 'editor.background': '#123456' } });
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
        assert.equal(config().get('borrowed-light.harmony'), 'triad');
        assert.equal(config().get('borrowed-light.appearance'), 'light');
        assert.equal(app.active, themeNames.light);
        await app.restore();
        for (const section of customizationSections) { assert.deepEqual(config().inspect(section)?.globalValue, before[section]); }
    });
    test('cancel preview preserves subsequent manual edits and a separately selected theme', async () => {
        const app = new ThemeApplication(new Memory());
        await app.beginPreview();
        await app.apply(generateTheme(palette, 'light'));
        const colors = config().inspect<Values>('workbench.colorCustomizations')!.globalValue!;
        (colors['[Borrowed Light (Light)]'] as Values)['editor.background'] = '#abcdef';
        await config().update('workbench.colorCustomizations', colors, vscode.ConfigurationTarget.Global);
        await config().update('workbench.colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
        await app.finishPreview(false);
        assert.equal(app.active, 'Default Dark Modern');
        assert.equal((config().inspect<Values>('workbench.colorCustomizations')!.globalValue!['[Borrowed Light (Light)]'] as Values)['editor.background'], '#abcdef');
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
        const colors = () => (config().inspect<Values>('workbench.colorCustomizations')?.globalValue?.['[Borrowed Light (Light)]'] as Values | undefined);
        try {
            await wait(() => app.active === themeNames.light);
            await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
            await wait(() => JSON.stringify(colors()) === JSON.stringify(variants.monochromatic.light.theme.colors));
            picker.cyclePrimary();
            picker.toggleAppearance();
            await wait(() => app.active === themeNames.dark);
            if (process.env.BORROWED_LIGHT_SCREENSHOT_DIR) {
                await new Promise(resolve => setTimeout(resolve, 500));
                await promisify(execFile)('import', ['-window', 'root', `${process.env.BORROWED_LIGHT_SCREENSHOT_DIR}/picker.png`]);
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
                const matches = () => app.active === themeNames.dark && JSON.stringify(config().inspect<Values>('workbench.colorCustomizations')?.globalValue?.['[Borrowed Light (Dark)]']) === JSON.stringify(variants[rule].dark.theme.colors);
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
            assert.deepEqual(await picker.closed, { harmony: 'triad', appearance: 'dark', primaries: { dark: 'automatic', light: 'automatic' }, syntaxStyle: 'balanced' });
            assert.equal(config().get('borrowed-light.harmony'), 'triad');
            assert.equal(config().get('borrowed-light.appearance'), 'dark');
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
            generate: (swatches, rule, mode, primary, signal, style) => runVariant(join(__dirname, '../../dist/palette-worker.js'), swatches, rule, mode, primary, signal, style),
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
            if (process.env.BORROWED_LIGHT_SCREENSHOT_DIR) {
                await new Promise(resolve => setTimeout(resolve, 500));
                await promisify(execFile)('import', ['-window', 'root', `${process.env.BORROWED_LIGHT_SCREENSHOT_DIR}/primary-picker.png`]);
            }
            await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
            assert.deepEqual((await picker.closed)?.primaries, { dark: 'wallpaper-2', light: 'wallpaper-1' });
            assert.equal(config().get('borrowed-light.primaryDark'), 'wallpaper-2');
            assert.equal(config().get('borrowed-light.primaryLight'), 'wallpaper-1');
            assert.deepEqual(errors, []);
        } finally { await picker.cancel(); await app.restore(); }
    });
    test('syntax styles preview live, preserve light/primary colors, save on Enter, and revert on Escape', async () => {
        const app = new ThemeApplication(new Memory());
        const swatches = [{ hex: '#229944', weight: 0.7 }, { hex: '#2266cc', weight: 0.15 }, { hex: '#eedd22', weight: 0.1 }, { hex: '#cc3322', weight: 0.05 }];
        const primaries = { light: 'wallpaper-2', dark: 'wallpaper-1' } as const;
        const directory = await mkdtemp(join(tmpdir(), 'wallpaper-syntax-'));
        const path = join(directory, 'preview.ts');
        await writeFile(path, '// Wallpaper colors highlight identifiers and syntax\ninterface Color { hex: string; weight: number }\nconst colors: Color[] = [{ hex: "#229944", weight: 0.7 }];\nfunction describe(color: Color): string {\n    return `${color.hex}: ${color.weight * 100}%`;\n}\ncolors.map(color => describe(color));\n');
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path)));
        let writes = Promise.resolve();
        const errors: unknown[] = [];
        let previewReady = false;
        const start = (style: 'balanced' | 'vibrant') => {
            previewReady = false;
            return createPreviewPicker({
                application: app, prepare: async () => ({ variants: generateVariants(swatches, primaries, style), harmony: 'analogous', appearance: 'light', primaries, syntaxStyle: style }),
                enqueue: action => { const next = writes.then(async () => { await action(); previewReady = true; }); writes = next.catch(() => {}); return next; },
                generate: (swatches, rule, mode, primary, signal, style) => runVariant(join(__dirname, '../../dist/palette-worker.js'), swatches, rule, mode, primary, signal, style),
                error: error => { errors.push(error); },
            });
        };
        const waitFor = async (style: 'mellow' | 'balanced' | 'vibrant' | 'vibrant-alt') => {
            const expected = generateVariant(swatches, 'analogous', 'light', primaries.light, style).theme;
            // Reopening a picker can already match the previous theme before preparation finishes.
            const matches = () => previewReady && app.active === themeNames.light && JSON.stringify((config().inspect<Values>('editor.semanticTokenColorCustomizations')?.globalValue?.['[Borrowed Light (Light)]'] as Values | undefined)?.rules) === JSON.stringify(expected.semanticRules);
            const deadline = Date.now() + 10000;
            while (!matches() && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 50)); }
            assert.ok(matches(), style);
            assert.deepEqual(config().inspect<Values>('workbench.colorCustomizations')?.globalValue?.['[Borrowed Light (Light)]'], expected.colors);
            if (process.env.BORROWED_LIGHT_SCREENSHOT_DIR) {
                await new Promise(resolve => setTimeout(resolve, 500));
                await promisify(execFile)('import', ['-window', 'root', `${process.env.BORROWED_LIGHT_SCREENSHOT_DIR}/syntax-${style}.png`]);
            }
        };
        let picker = start('balanced');
        try {
            await waitFor('balanced');
            picker.cycleSyntax(-1); await waitFor('mellow');
            picker.cycleSyntax(); picker.cycleSyntax(); await waitFor('vibrant');
            await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
            assert.equal((await picker.closed)?.syntaxStyle, 'vibrant');
            assert.equal(config().get('borrowed-light.syntaxStyle'), 'vibrant');
            const baseline = Object.fromEntries(sections.map(section => [section, config().inspect(section)?.globalValue]));
            picker = start('vibrant'); await waitFor('vibrant');
            picker.cycleSyntax(); await waitFor('vibrant-alt');
            await picker.cancel();
            for (const section of sections) { assert.deepEqual(config().inspect(section)?.globalValue, baseline[section], section); }
            assert.deepEqual(errors, []);
        } finally { await picker.cancel(); await app.restore(); await vscode.commands.executeCommand('workbench.action.closeAllEditors'); }
    });
    test('Python HTML documents expose HTML, JS and CSS scopes while ordinary strings remain Python', async () => {
        const app = new ThemeApplication(new Memory());
        const fixture = join(await mkdtemp(join(tmpdir(), 'wallpaper-html-')), 'viewer.py');
        await writeFile(fixture, [
            '# HTML document embedded in a Python string',
            'page = """', '<!DOCTYPE html>', '<html>', '<head>',
            '<style>body { color: red; margin: 20px; }</style>', '</head>', '<body>',
            '<h1 class="title">Session viewer</h1>', '<script>',
            'function totalPunches(count) { return count + 20; }',
            'const title = "frequency sweep";',
            'let sessionIndex = 0;',
            'if (totalPunches(sessionIndex) === 20) {',
            '    document.addEventListener("keydown", event => {',
            '        sessionIndex += Number(event.target.value);',
            '    });', '}',
            '// The opposite triple quote belongs to JavaScript here',
            'const quotes = "\'\'\'";',
            '</script>', '</body>', '</html>', '"""',
            'def after_document():', '    return 42',
            'plain = """not HTML: function untouched() { return 9; }"""',
            'raw = r\'\'\'<html><script>const rawValue = 7;</script></html>\'\'\'',
            'formatted = f"""<html>{title}</html>"""',
            '# """<html>not a template</html>"""',
            'unfinished = """<html>', '<body>Incomplete document', '"""',
            'def after_unfinished():', '    return 99',
        ].join('\n'));
        const uri = vscode.Uri.file(fixture);
        const tokens = await vscode.commands.executeCommand<{ c: string; t: string }[]>('_workbench.captureSyntaxTokens', uri);
        const has = (content: string, scope: string) => tokens?.some(token => token.c === content && token.t.includes(scope));
        assert.ok(has('html', 'entity.name.tag'), JSON.stringify(tokens));
        assert.ok(has('function', 'storage.type.function.js'), JSON.stringify(tokens));
        assert.ok(has('totalPunches', 'entity.name.function'));
        assert.ok(has('20', 'constant.numeric'));
        assert.ok(has('color', 'support.type.property-name.css'));
        assert.ok(has('rawValue', 'source.js'), JSON.stringify(tokens?.filter(token => token.c.includes('raw') || token.c.includes('Value')).map(({ c, t }) => ({ c, t }))));
        assert.ok(has('after_document', 'entity.name.function.python'), 'matching delimiter returns to Python');
        assert.ok(has('after_unfinished', 'entity.name.function.python'), 'unfinished HTML does not swallow subsequent Python');
        assert.ok(tokens?.some(token => token.c.includes('untouched') && token.t.includes('string.quoted.multi.python') && !token.t.includes('source.js')));
        assert.ok(tokens?.some(token => token.c.includes('<html>') && token.t.includes('meta.fstring.python') && !token.t.includes('meta.embedded.block.html')), 'formatted strings keep interpolation');
        assert.ok(tokens?.some(token => token.c.includes('not a template') && token.t.includes('comment.line') && !token.t.includes('meta.embedded.block.html')));
        try {
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
            const swatches = [{ hex: '#697663', weight: 1 }];
            for (const mode of ['light', 'dark'] as const) {
                await app.apply(generateVariant(swatches, 'complementary', mode, 'harmony-1', 'vibrant').theme);
                if (process.env.BORROWED_LIGHT_SCREENSHOT_DIR) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await promisify(execFile)('import', ['-window', 'root', `${process.env.BORROWED_LIGHT_SCREENSHOT_DIR}/embedded-${mode}.png`]);
                }
            }
        } finally { await app.restore(); await vscode.commands.executeCommand('workbench.action.closeAllEditors'); }
    });
    test('green-wallpaper vibrant highlighting distinguishes real Python scopes without semantic tokens', async () => {
        const app = new ThemeApplication(new Memory());
        const swatches = ['#34402f', '#100d0a', '#4a5033', '#2a2e22', '#505d3f', '#8f931e', '#3d5039', '#91975c'].map(hex => ({ hex, weight: 1 / 8 }));
        const fixture = join(await mkdtemp(join(tmpdir(), 'wallpaper-python-')), 'sweep.py');
        await writeFile(fixture, '# Green wallpaper, diverse syntax families\n'.repeat(10) + 'from math import sin\n\nclass Signal:\n    def sweep(self, frequency: float, count: int = 20) -> str:\n        label = "frequency sweep"\n        phase = 2.0 * frequency\n        return str(sin(phase))\n\nresponse = Signal().sweep(100.0)\nprint(response)\n');
        const uri = vscode.Uri.file(fixture);
        const tokens = await vscode.commands.executeCommand<{ c: string; t: string }[]>('_workbench.captureSyntaxTokens', uri);
        assert.ok(tokens?.some(token => token.c === 'def' && token.t.includes('storage.type.function.python')));
        assert.ok(tokens?.some(token => token.c === 'sweep' && token.t.includes('entity.name.function.python')));
        assert.ok(tokens?.some(token => token.c === 'sin' && token.t.includes('meta.function-call.generic.python')));
        assert.ok(tokens?.some(token => token.c === 'print' && token.t.includes('support.function.builtin.python')));
        assert.ok(tokens?.some(token => token.c === 'float' && token.t.includes('support.type.python')));
        assert.ok(tokens?.some(token => token.c.includes('20') && token.t.includes('constant.numeric')));
        const controls = ['editor.semanticHighlighting.enabled', 'editor.bracketPairColorization.enabled'];
        const originals = Object.fromEntries(controls.map(key => [key, config().inspect(key)?.globalValue]));
        try {
            for (const key of controls) { await config().update(key, false, vscode.ConfigurationTarget.Global); }
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
            for (const mode of ['light', 'dark'] as const) {
                const result = generateVariant(swatches, 'complementary', mode, 'harmony-5', 'vibrant-alt');
                await app.apply(result.theme);
                const rules = (config().inspect<Values>('editor.tokenColorCustomizations')?.globalValue?.[`[${themeNames[mode]}]`] as { textMateRules: typeof result.theme.textMateRules }).textMateRules;
                const colors = ['storage', 'entity.name.function', 'support.type', 'string', 'constant.numeric'].map(scope => rules.find(rule => rule.scope.includes(scope))!.settings.foreground);
                assert.equal(new Set(colors).size, 5);
                if (process.env.BORROWED_LIGHT_SCREENSHOT_DIR) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await promisify(execFile)('import', ['-window', 'root', `${process.env.BORROWED_LIGHT_SCREENSHOT_DIR}/python-${mode}.png`]);
                }
            }
        } finally {
            await app.restore();
            for (const key of controls) { await config().update(key, originals[key], vscode.ConfigurationTarget.Global); }
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        }
    });
});
