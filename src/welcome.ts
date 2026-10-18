import * as vscode from 'vscode';

export type WelcomeState = 'pending' | 'ready' | 'failed' | 'existing' | 'paused';
const commands = ['borrowed-light.preview', 'borrowed-light.sync', 'borrowed-light.toggleAutoSync', 'borrowed-light.toggleDesktopAppearance', 'borrowed-light.restore', 'workbench.action.openSettings'];
const commandLink = (command: string, label: string, args?: unknown[]) => `<a href="command:${command}${args ? '?' + encodeURIComponent(JSON.stringify(args)) : ''}">${label}</a>`;
export function welcomeHtml(state: WelcomeState): string {
    const message = {
        pending: 'Setting up your wallpaper theme…',
        ready: 'Your VS Code theme is now syncing.',
        failed: 'Your theme could not be synced yet. Check Borrowed Light in the Output panel, then try Sync again.',
        paused: 'Automatic syncing is currently paused or off. Run Sync now to apply your wallpaper theme.',
        existing: 'Make your editor feel at home with your wallpaper.',
    }[state];
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{max-width:760px;margin:40px auto;padding:0 24px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);line-height:1.6}
h1{font-size:2em}h2{margin-top:1.6em;font-size:1.2em}a{color:var(--vscode-textLink-foreground)}li{margin:10px 0}.intro{padding:16px;border:1px solid var(--vscode-panel-border);border-radius:8px}code{font-family:var(--vscode-editor-font-family)}
</style></head><body><h1>Welcome to Borrowed Light!</h1><p class="intro">${message}</p>
<p>Generate readable light and dark themes from your desktop wallpaper. No extra software is needed on supported desktops.</p>
<h2>Make it yours</h2><ul>
<li>${commandLink('borrowed-light.preview', 'Preview color schemes')}: cycle color rules, background hues, syntax styles, and light/dark previews. Enter keeps your choice; Escape restores it.</li>
<li>${commandLink('workbench.action.openSettings', 'Adjust light tint', ['borrowed-light.backgroundTintLight'])} or ${commandLink('workbench.action.openSettings', 'dark tint', ['borrowed-light.backgroundTintDark'])}: choose subtle, balanced, or colorful surfaces separately for light and dark themes. Light defaults to subtle; dark keeps its original styling by default. Syntax colors stay independent.</li></ul>
<h2>Choose what follows your desktop</h2><ul>
<li>${commandLink('borrowed-light.toggleAutoSync', 'Toggle wallpaper sync')} to follow wallpaper changes or keep your last synced palette.</li>
<li>${commandLink('borrowed-light.toggleDesktopAppearance', 'Toggle system light/dark following')} to follow system mode or keep the currently visible mode.</li></ul>
<p>The two controls are independent. Their status bar indicators show On, Off, Paused, or Error. Choosing another VS Code theme pauses automatic updates.</p>
<p>${commandLink('borrowed-light.sync', 'Sync now')} explicitly refreshes your wallpaper palette. ${commandLink('borrowed-light.restore', 'Restore your previous theme')} also turns both automatic behaviors off.</p>
<p>You can reopen this page with <strong>Borrowed Light: Show Welcome</strong> in the Command Palette.</p></body></html>`;
}
export class WelcomePage implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private state: WelcomeState = 'existing';
    show(): void {
        if (this.panel) { this.panel.reveal(); return; }
        const panel = vscode.window.createWebviewPanel('borrowedLightWelcome', 'Welcome to Borrowed Light', vscode.ViewColumn.Active,
            { enableScripts: false, enableCommandUris: commands, localResourceRoots: [] });
        this.panel = panel;
        panel.webview.html = welcomeHtml(this.state);
        panel.onDidDispose(() => { if (this.panel === panel) { this.panel = undefined; } });
    }
    update(state: WelcomeState): void { if (state === this.state) { return; } this.state = state; if (this.panel) { this.panel.webview.html = welcomeHtml(state); } }
    finishSetup(ready: boolean): void { if (this.state === 'pending') { this.update(ready ? 'ready' : 'paused'); } }
    syncing(active: boolean): void {
        if (this.state === 'ready' || this.state === 'paused') { this.update(active ? 'ready' : 'paused'); }
    }
    dispose(): void { this.panel?.dispose(); }
}
