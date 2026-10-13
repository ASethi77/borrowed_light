import { spawn } from 'node:child_process';
import { watch, FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Disposable } from '../contracts';
import { powershellArguments, powershellExecutable } from './wallpaper';
import { wallpaperWatchScript } from './scripts';

/** One sleeping native helper receives registry events, without repeatedly launching
 * PowerShell. Cache events also cover slideshows and per-monitor wallpaper updates.
 */
export function watchWindowsWallpaper(changed: () => void, failed: (error: Error) => void): Disposable {
    let disposed = false, reported = false, pending = '', errors = '';
    let cache: FSWatcher | undefined;
    const notify = () => { if (!disposed) { changed(); } };
    const failure = (error: Error) => {
        if (!disposed && !reported) { reported = true; failed(error); }
    };
    const child = spawn(powershellExecutable(), powershellArguments(wallpaperWatchScript), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const startup = setTimeout(() => {
        failure(new Error('Windows wallpaper monitor did not start; periodic checks remain active'));
        child.kill();
    }, 10000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
        if (disposed) { return; }
        pending += chunk;
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline).trim();
            pending = pending.slice(newline + 1);
            if (line === 'ready') { clearTimeout(startup); notify(); }
            else if (line === 'changed') { notify(); }
        }
        if (pending.length > 1024) { pending = ''; failure(new Error('Invalid Windows monitor output')); child.kill(); }
    });
    child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString('utf8')).slice(-4096); });
    child.stdin.on('error', failure);
    child.on('error', error => { clearTimeout(startup); failure(error); });
    child.on('close', code => {
        clearTimeout(startup);
        failure(new Error(`Windows wallpaper monitor stopped (${code}); periodic checks remain active${errors.trim() ? ': ' + errors.trim() : ''}`));
    });
    try {
        cache = watch(join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Themes'), { recursive: true }, (_event, filename) => {
            if (!filename || /Transcoded|CachedFiles|\.theme$/i.test(filename.toString())) { notify(); }
        });
        cache.on('error', failure);
    } catch (error) { failure(error instanceof Error ? error : new Error(String(error))); }
    return { dispose: () => {
        if (disposed) { return; }
        disposed = true;
        clearTimeout(startup);
        cache?.close();
        child.stdin.end();
        child.kill();
    } };
}
