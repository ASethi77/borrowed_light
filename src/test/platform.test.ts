import { customizationSections } from '../application';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { detectPlatform } from '../platform/os_detect';
import { selectProvider } from '../platform/os_wallpaper';
import { wallpaperPath } from '../image/source';
import { stat } from 'node:fs/promises';

suite('Native desktop wallpaper smoke test', () => {
    test('discover primary-display wallpaper in an actual Windows/macOS desktop session', async function () {
        // CI exercises real native codecs; desktop discovery needs a populated GUI session.
        // Opt-in avoids silently claiming a runner with no configured wallpaper was verified.
        if (process.env.BORROWED_LIGHT_NATIVE_SMOKE !== '1' || !['win32', 'darwin'].includes(process.platform)) { this.skip(); }
        const platform = detectPlatform();
        const provider = await selectProvider(platform);
        assert.notEqual(provider.id, 'unsupported');
        const wallpaper = await provider.current();
        assert.ok((await stat(wallpaperPath(wallpaper.uri))).isFile());
        assert.ok(['light', 'dark'].includes(wallpaper.appearance));
        const config = () => vscode.workspace.getConfiguration();
        const keys = [...customizationSections, 'workbench.colorTheme', 'borrowed-light.autoSync', 'borrowed-light.platformProvider', 'borrowed-light.borderContrast', 'borrowed-light.appearance', 'borrowed-light.primaryDark', 'borrowed-light.primaryLight'];
        const originals = Object.fromEntries(keys.map(key => [key, config().inspect(key)?.globalValue]));
        try {
            // Force automatic selection for this test, then restore the user's preference.
            await config().update('borrowed-light.autoSync', false, vscode.ConfigurationTarget.Global);
            await config().update('borrowed-light.platformProvider', 'auto', vscode.ConfigurationTarget.Global);
            await config().update('borrowed-light.borderContrast', 'mellow', vscode.ConfigurationTarget.Global);
            await config().update('borrowed-light.appearance', 'desktop', vscode.ConfigurationTarget.Global);
            await vscode.commands.executeCommand('borrowed-light.sync');
            const theme = config().get<string>('workbench.colorTheme');
            const border = config().inspect<Record<string, Record<string, string>>>('workbench.colorCustomizations')?.globalValue?.[`[${theme}]`]?.['panel.border'];
            assert.ok(border);
            assert.equal(theme, `Borrowed Light (${wallpaper.appearance === 'light' ? 'Light' : 'Dark'})`);
            await config().update('borrowed-light.primaryDark', 'wallpaper-1', vscode.ConfigurationTarget.Global);
            await config().update('borrowed-light.primaryLight', 'wallpaper-2', vscode.ConfigurationTarget.Global);
            await vscode.commands.executeCommand('borrowed-light.sync');
            assert.equal(config().get('borrowed-light.borderContrast'), 'mellow');
            assert.equal(config().get('borrowed-light.appearance'), 'desktop');
            assert.equal(config().get('borrowed-light.primaryDark'), 'wallpaper-1');
            assert.equal(config().get('borrowed-light.primaryLight'), 'wallpaper-2');

            assert.ok(['Borrowed Light (Dark)', 'Borrowed Light (Light)'].includes(vscode.workspace.getConfiguration().get<string>('workbench.colorTheme') ?? ''));
            await vscode.commands.executeCommand('borrowed-light.report');
        } finally {
            await vscode.commands.executeCommand('borrowed-light.restore');
            for (const key of keys) { await config().update(key, originals[key], vscode.ConfigurationTarget.Global); }
        }
    });
});
