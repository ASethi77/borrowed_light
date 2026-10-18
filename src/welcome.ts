import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { SyncIndicatorState } from './sync_state';

export type WelcomeState = 'pending' | 'ready' | 'failed' | 'existing' | 'paused';
interface WelcomeSync { wallpaper: SyncIndicatorState; appearance: SyncIndicatorState }
interface WelcomeMedia { source: string; nonce: string; system: string; background: string; syntax: string }
const commands = ['borrowed-light.preview', 'borrowed-light.sync', 'borrowed-light.toggleAutoSync', 'borrowed-light.toggleDesktopAppearance', 'borrowed-light.restore', 'workbench.action.openSettings'];
const commandLink = (command: string, label: string, args?: unknown[]) => `<a href="command:${command}${args ? '?' + encodeURIComponent(JSON.stringify(args)) : ''}">${label}</a>`;
const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const messages: Record<WelcomeState, string> = {
    pending: 'Making your editor feel at home with your desktop wallpaper…',
    ready: 'Your VS Code theme is now being synced to your desktop wallpaper.',
    failed: 'Your theme could not be synced yet. Check Borrowed Light in the Output panel, then try Sync again.',
    paused: 'Your wallpaper colors are yours to keep. Turn on wallpaper sync or choose Sync now whenever you’d like a refresh.',
    existing: 'Make your editor feel at home with your desktop wallpaper.',
};
const statusText = (state: SyncIndicatorState) => `${state === 'On' ? '✓' : state === 'Syncing' ? '↻' : '✕'} ${state === 'On' ? 'Synced to desktop' : state}`;
export function welcomeHtml(state: WelcomeState, sync: WelcomeSync, media: WelcomeMedia): string {
    const video = (uri: string, label: string) => `<video controls muted playsinline preload="metadata" aria-label="${label}"><source src="${escapeAttribute(uri)}" type="video/mp4">Your editor could not play this demo.</video>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${escapeAttribute(media.source)}; style-src 'unsafe-inline'; script-src 'nonce-${media.nonce}';"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{max-width:760px;margin:40px auto;padding:0 24px 40px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);line-height:1.6}
h1{font-size:2em;line-height:1.25}h2{margin-top:1.8em;font-size:1.4em}h3{margin-top:1.5em;font-size:1.1em}a{color:var(--vscode-textLink-foreground)}li{margin:14px 0}.intro{padding:18px 20px;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-textBlockQuote-background)}.intro p{margin:0}.intro p+p{margin-top:6px}.intro strong{font-size:1.1em}video{display:block;width:100%;height:auto;margin:18px 0 28px;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-editor-background)}.status{display:inline-block;margin:4px 0;font-weight:600}.status[data-state="On"]{color:var(--vscode-testing-iconPassed)}.status[data-state="Error"]{color:var(--vscode-errorForeground)}.sync-options{list-style:none;padding:0}.sync-options li{padding:14px 18px;border:1px solid var(--vscode-panel-border);border-radius:8px}.sync-options p{margin:4px 0}
</style></head><body><h1>Welcome to Borrowed Light!</h1><div class="intro"><p><strong id="welcome-message">${messages[state]}</strong></p><p>No extra software required. Just your wallpaper, a little color, and an editor that feels like yours.</p></div>
<p>Borrowed Light brings the colors of your wallpaper into readable light and dark themes, and follows your desktop as it changes.</p>
${video(media.system, 'Wallpaper and system light/dark syncing demo')}
<h2>Make it yours</h2>
<p>${commandLink('borrowed-light.preview', 'Open the theme preview')} to try your choices live. Enter keeps your choice; Escape restores it.</p>
<h3>Background hue</h3>
<p>Explore color harmonies and choose your favorite wallpaper or harmony hue for each light and dark background.</p>
${video(media.background, 'Background hue selection demo')}
<p>${commandLink('workbench.action.openSettings', 'Adjust light tint', ['borrowed-light.backgroundTintLight'])} or ${commandLink('workbench.action.openSettings', 'dark tint', ['borrowed-light.backgroundTintDark'])} to make surfaces subtle, balanced, or colorful. Light starts subtle; dark starts colorful. Syntax colors stay independent.</p>
<h3>Syntax highlighting and borders</h3>
<p>Choose Mellow, Balanced, Vibrant, or Vibrant Alternate syntax highlighting, then set pane borders to Mellow, Balanced, or Vibrant. Mix them to find the level of color and definition that feels right.</p>
${video(media.syntax, 'Syntax highlighting and border selection demo')}
<h2>Choose what follows your desktop</h2><ul class="sync-options">
<li><strong>Wallpaper</strong><br><span id="wallpaper-status" class="status" role="status" data-state="${sync.wallpaper}">${statusText(sync.wallpaper)}</span><p>${commandLink('borrowed-light.toggleAutoSync', 'Toggle wallpaper sync')} to follow wallpaper changes or keep your last synced palette.</p></li>
<li><strong>Light/dark appearance</strong><br><span id="appearance-status" class="status" role="status" data-state="${sync.appearance}">${statusText(sync.appearance)}</span><p>${commandLink('borrowed-light.toggleDesktopAppearance', 'Toggle system light/dark following')} to follow system mode or keep the currently visible mode.</p></li></ul>
<p>These controls work independently. Choosing another VS Code theme pauses automatic updates.</p>
<p>${commandLink('borrowed-light.sync', 'Sync now')} refreshes your wallpaper palette. ${commandLink('borrowed-light.restore', 'Restore your previous theme')} also turns both automatic behaviors off.</p>
<p>You can always come back here with <strong>Borrowed Light: Show Welcome</strong> in the Command Palette.</p>
<script nonce="${media.nonce}">
const messages = ${JSON.stringify(messages)};
const statusText = state => (state === 'On' ? '✓ Synced to desktop' : (state === 'Syncing' ? '↻ ' : '✕ ') + state);
window.addEventListener('message', ({ data }) => {
    if (data.type !== 'welcomeStatus') { return; }
    document.getElementById('welcome-message').textContent = messages[data.state];
    for (const key of ['wallpaper', 'appearance']) {
        const element = document.getElementById(key + '-status');
        element.textContent = statusText(data.sync[key]);
        element.dataset.state = data.sync[key];
    }
});
acquireVsCodeApi().postMessage({ type: 'welcomeReady' });
</script></body></html>`;
}
export class WelcomePage implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private state: WelcomeState = 'existing';
    private sync: WelcomeSync = { wallpaper: 'Off', appearance: 'Off' };
    constructor(private readonly extensionUri: vscode.Uri) {}
    show(): void {
        if (this.panel) { this.panel.reveal(); return; }
        const root = vscode.Uri.joinPath(this.extensionUri, 'docs', 'demo');
        const panel = vscode.window.createWebviewPanel('borrowedLightWelcome', 'Welcome to Borrowed Light', vscode.ViewColumn.Active,
            { enableScripts: true, enableCommandUris: commands, localResourceRoots: [root] });
        this.panel = panel;
        panel.webview.onDidReceiveMessage(message => { if (message?.type === 'welcomeReady') { this.refresh(); } });
        const uri = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(root, file)).toString();
        panel.webview.html = welcomeHtml(this.state, this.sync, {
            source: panel.webview.cspSource, nonce: randomBytes(16).toString('hex'),
            system: uri('system_syncing_demo.mp4'), background: uri('background_hue_selection.mp4'), syntax: uri('syntax_highlighting_options.mp4'),
        });
        panel.onDidDispose(() => { if (this.panel === panel) { this.panel = undefined; } });
    }
    private refresh(): void {
        // Update just the copy so a desktop sync never restarts a playing demo.
        void this.panel?.webview.postMessage({ type: 'welcomeStatus', state: this.state, sync: this.sync });
    }
    update(state: WelcomeState): void { if (state === this.state) { return; } this.state = state; this.refresh(); }
    finishSetup(ready: boolean): void { if (this.state === 'pending') { this.update(ready ? 'ready' : 'paused'); } }
    syncing(wallpaper: SyncIndicatorState, appearance: SyncIndicatorState): void {
        if (this.sync.wallpaper === wallpaper && this.sync.appearance === appearance) { return; }
        this.sync = { wallpaper, appearance };
        if (this.state === 'ready' || this.state === 'paused') { this.state = wallpaper === 'On' || wallpaper === 'Syncing' ? 'ready' : 'paused'; }
        this.refresh();
    }
    dispose(): void { this.panel?.dispose(); }
}
