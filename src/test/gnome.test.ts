import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { customizationSections } from '../application';
import { contrast } from '../colors';
import { Values } from '../ownership';

suite('GNOME wallpaper smoke test', () => {
    test('real wallpaper sync, language editors, light/dark controls, and palette report', async function () {
        if (process.env.WALLPAPER_PASTE_GNOME_SMOKE !== '1') { this.skip(); }
        const config = vscode.workspace.getConfiguration();
        const keys = [...customizationSections, 'workbench.colorTheme', 'wallpaper-paste.appearance', 'wallpaper-paste.harmony', 'wallpaper-paste.autoSync'];
        const originals = Object.fromEntries(keys.map(key => [key, config.inspect(key)?.globalValue]));
        const fixtures = await mkdtemp(join(tmpdir(), 'wallpaper-paste-editors-'));
        try {
            await config.update('wallpaper-paste.autoSync', false, vscode.ConfigurationTarget.Global);
            for (const appearance of ['dark', 'light']) {
                await config.update('wallpaper-paste.appearance', appearance, vscode.ConfigurationTarget.Global);
                await vscode.commands.executeCommand('wallpaper-paste.sync');
                const theme = `Wallpaper Paste ${appearance === 'dark' ? 'Dark' : 'Light'}`;
                assert.equal(vscode.workspace.getConfiguration().get('workbench.colorTheme'), theme);
                const colors = vscode.workspace.getConfiguration().inspect<Values>('workbench.colorCustomizations')!.globalValue![`[${theme}]`] as Record<string, string>;
                assert.ok(contrast(colors['editor.foreground'], colors['editor.background']) >= 4.5);
                assert.ok(contrast(colors['button.foreground'], colors['button.background']) >= 4.5);
                assert.ok(contrast(colors['input.foreground'], colors['input.background']) >= 4.5);
                for (const [language, content] of [
                    ['typescript', '// Wallpaper theme\ninterface Color { hex: string }\nconst count = 42;\nfunction greet(name: string) { return `Hello ${name}`; }'],
                    ['python', '# Wallpaper theme\ndef greet(name: str):\n    return f"Hello {name}"\ncount = 42'],
                    ['markdown', '# Wallpaper theme\n\nA **readable** palette with `inline code`.\n\n[Documentation](https://example.com)'],
                ]) {
                    const path = join(fixtures, `${language}.${language === 'typescript' ? 'ts' : language === 'python' ? 'py' : 'md'}`);
                    await writeFile(path, content);
                    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
                    await vscode.window.showTextDocument(document);
                }
                await vscode.commands.executeCommand('wallpaper-paste.report');
                const reportOpen = () => vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.label === 'Wallpaper Palette & Contrast'));
                const reportDeadline = Date.now() + 5000;
                while (!reportOpen() && Date.now() < reportDeadline) { await new Promise(resolve => setTimeout(resolve, 100)); }
                assert.ok(reportOpen(), 'palette webview becomes visible');
                if (process.env.WALLPAPER_PASTE_SCREENSHOT_DIR) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    await promisify(execFile)('import', ['-window', 'root', `${process.env.WALLPAPER_PASTE_SCREENSHOT_DIR}/${appearance}.png`]);
                }
                await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            }
            const keyword = () => {
                const tokens = vscode.workspace.getConfiguration().inspect<Values>('editor.tokenColorCustomizations')!.globalValue!['[Wallpaper Paste Light]'] as { textMateRules: { settings: { foreground: string } }[] };
                return tokens.textMateRules[1].settings.foreground;
            };
            const previousKeyword = keyword();
            await config.update('wallpaper-paste.autoSync', true, vscode.ConfigurationTarget.Global);
            await config.update('wallpaper-paste.harmony', 'compound', vscode.ConfigurationTarget.Global);
            const deadline = Date.now() + 10000;
            while (keyword() === previousKeyword && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 100)); }
            assert.notEqual(keyword(), previousKeyword, 'opt-in monitoring regenerates on palette settings changes');
            await config.update('workbench.colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
            const paused = vscode.workspace.getConfiguration().inspect('editor.tokenColorCustomizations')?.globalValue;
            await config.update('wallpaper-paste.harmony', 'monochromatic', vscode.ConfigurationTarget.Global);
            await new Promise(resolve => setTimeout(resolve, 1000));
            assert.deepEqual(vscode.workspace.getConfiguration().inspect('editor.tokenColorCustomizations')?.globalValue, paused);
            assert.equal(vscode.workspace.getConfiguration().get('workbench.colorTheme'), 'Default Dark Modern');
            await vscode.commands.executeCommand('wallpaper-paste.restore');
            assert.equal(vscode.workspace.getConfiguration().get('wallpaper-paste.autoSync'), false);
        } finally {
            for (const key of keys) { await config.update(key, originals[key], vscode.ConfigurationTarget.Global); }
        }
    });
});
