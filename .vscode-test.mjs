import { defineConfig } from '@vscode/test-cli';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fixture previews must not race first-install sync or a previous test run's wallpaper
// snapshot. Desktop smoke tests opt into real syncing explicitly; lifecycle unit tests
// separately cover automatic first-install setup and all four sync combinations.
const profile = mkdtempSync(join(tmpdir(), 'borrowed-light-host-'));
mkdirSync(join(profile, 'User'), { recursive: true });
writeFileSync(join(profile, 'User', 'settings.json'), JSON.stringify({
    'borrowed-light.autoSync': false,
    'borrowed-light.appearance': 'dark',
}));
process.once('exit', () => {
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch { /* A lingering VS Code process may hold a Windows file lock until exit. */ }
});

export default defineConfig({
    files: ['out/test/extension.test.js', 'out/test/gnome.test.js', 'out/test/platform.test.js'],
    useInstallation: process.env.VSCODE_EXECUTABLE_PATH ? { fromPath: process.env.VSCODE_EXECUTABLE_PATH } : undefined,
    launchArgs: [`--user-data-dir=${profile}`, '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-extensions', ...(process.platform === 'linux' ? ['--ozone-platform=x11', '--no-sandbox'] : [])],
    mocha: { timeout: 120000 },
});
