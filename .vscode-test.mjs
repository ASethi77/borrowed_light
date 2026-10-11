import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    files: ['out/test/extension.test.js', 'out/test/gnome.test.js', 'out/test/platform.test.js'],
    useInstallation: process.env.VSCODE_EXECUTABLE_PATH ? { fromPath: process.env.VSCODE_EXECUTABLE_PATH } : undefined,
    launchArgs: ['--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-extensions', ...(process.platform === 'linux' ? ['--ozone-platform=x11', '--no-sandbox'] : [])],
    mocha: { timeout: 120000 },
});
