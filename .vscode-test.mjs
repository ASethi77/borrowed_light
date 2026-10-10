import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    files: ['out/test/extension.test.js', 'out/test/gnome.test.js'],
    useInstallation: process.env.VSCODE_EXECUTABLE_PATH ? { fromPath: process.env.VSCODE_EXECUTABLE_PATH } : undefined,
    launchArgs: ['--disable-gpu', '--ozone-platform=x11', '--no-sandbox', '--skip-welcome', '--skip-release-notes', '--disable-extensions'],
    mocha: { timeout: 120000 },
});
