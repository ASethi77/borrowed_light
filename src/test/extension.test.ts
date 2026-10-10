import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { ThemeApplication, customizationSections } from '../application';
import { generateTheme, themeNames } from '../theme';
import { Values } from '../ownership';

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
    const sections = [...customizationSections, 'workbench.colorTheme', 'wallpaper-paste.autoSync'];
    let originals: Record<string, unknown>;
    setup(() => {
        originals = Object.fromEntries(sections.map(section => [section, config().inspect(section)?.globalValue]));
    });
    teardown(async () => {
        for (const section of sections) { await config().update(section, originals[section], vscode.ConfigurationTarget.Global); }
    });
    test('extension loads with all three commands and both theme contributions', async () => {
        const extension = vscode.extensions.getExtension('wallpaper-paste-local.wallpaper-paste');
        assert.ok(extension);
        await extension.activate();
        const commands = await vscode.commands.getCommands(true);
        for (const name of ['sync', 'report', 'restore']) { assert.ok(commands.includes(`wallpaper-paste.${name}`)); }
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
});
