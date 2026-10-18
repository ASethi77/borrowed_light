import { watch } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Disposable, WallpaperProvider, Wallpaper } from '../contracts';
import { ProcessRunner, runProcess } from '../process';
import { wallpaperPath, wallpaperUri } from '../../image/source';
import { wallpaperScript, appearanceScript } from './scripts';

export function osascriptArguments(script: string): string[] { return ['-l', 'JavaScript', '-e', script]; }
interface Selection { provider?: string; configuration?: { assetID?: string; url?: { relative?: string } }; files?: { relative?: string }[] }

/** Resolve only local files and known provider types; never use the fallback desktop
 * when a known aerial selection has no local preview available.
 */
export async function selectedWallpaperUri(selection: Selection | null | undefined, fallback: string | null, home = homedir(), exists: (path: string) => Promise<void> = access): Promise<string> {
    if (selection?.provider === 'com.apple.wallpaper.choice.aerials') {
        const id = selection.configuration?.assetID;
        if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) { throw new Error('macOS aerial wallpaper has no valid asset identifier'); }
        const candidates = [
            join(home, 'Library/Application Support/com.apple.wallpaper/aerials/thumbnails', `${id}.png`),
            join('/Library/Application Support/com.apple.idleassetsd/Customer', `${id}.jpg`),
            join('/Library/Application Support/com.apple.idleassetsd/Customer', `${id}.png`),
        ];
        for (const path of candidates) {
            try { await exists(path); return wallpaperUri(path); } catch { /* Try the other local cache layouts. */ }
        }
        throw new Error('No local preview for the selected macOS aerial wallpaper. Open Wallpaper settings to download its preview, then sync again.');
    }
    const uri = selection?.provider === 'com.apple.wallpaper.choice.image'
        ? selection.configuration?.url?.relative ?? selection.files?.[0]?.relative ?? fallback
        : fallback;
    if (!uri) { throw new Error('macOS primary display has no wallpaper image configured'); }
    wallpaperPath(uri);
    return uri;
}
export class MacosProvider implements WallpaperProvider {
    readonly id = 'macos';
    constructor(private readonly run: ProcessRunner = runProcess) {}
    async available(): Promise<boolean> {
        try { await this.run('/usr/bin/osascript', osascriptArguments("'ready'")); return true; }
        catch { return false; }
    }
    async appearance(): Promise<'light' | 'dark'> {
        const appearance = (await this.run('/usr/bin/osascript', osascriptArguments(appearanceScript))).toString('utf8').trim();
        if (appearance !== 'light' && appearance !== 'dark') { throw new Error('Invalid system appearance response'); }
        return appearance;
    }
    async current(): Promise<Wallpaper> {
        const value = JSON.parse((await this.run('/usr/bin/osascript', osascriptArguments(wallpaperScript))).toString('utf8')) as { uri: string | null; appearance: string; selection?: Selection };
        if (!value || typeof value !== 'object' || !(typeof value.uri === 'string' || value.uri === null) || !['light', 'dark'].includes(value.appearance)) {
            throw new Error('Invalid macOS wallpaper response');
        }
        const uri = await selectedWallpaperUri(value.selection, value.uri);
        return { uri, appearance: value.appearance as 'light' | 'dark', provider: this.id };
    }
    watch(changed: () => void, failed: (error: Error) => void): Disposable {
        let disposed = false;
        const notify = () => { if (!disposed) { changed(); } };
        // Directory watching survives the atomic replacement of Index.plist.
        let watcher: ReturnType<typeof watch> | undefined;
        try {
            watcher = watch(join(homedir(), 'Library/Application Support/com.apple.wallpaper/Store'), notify);
            watcher.on('error', error => { if (!disposed) { failed(error); } });
        } catch { /* Older macOS / unavailable store: polling remains active. */ }
        // A new helper reads appearance preferences fresh; also catches missed events.
        const timer = setInterval(notify, 5000);
        return { dispose: () => { disposed = true; watcher?.close(); clearInterval(timer); } };
    }
}
