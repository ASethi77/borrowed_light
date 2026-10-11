import { spawn } from 'node:child_process';
import { Wallpaper, WallpaperProvider, Disposable } from '../../contracts';
import { wallpaperPath } from '../../../image/source';
import { Run, runGsettings, parseGvariant } from './gsettings';

export class GnomeProvider implements WallpaperProvider {
    readonly id = 'linux-gnome';
    constructor(private readonly run: Run = runGsettings) {}
    async available(): Promise<boolean> {
        try {
            const schemas = (await this.run(['list-schemas'])).split(/\s+/);
            return ['org.gnome.desktop.background', 'org.gnome.desktop.interface'].every(s => schemas.includes(s));
        } catch { return false; }
    }
    async current(): Promise<Wallpaper> {
        const appearance = parseGvariant(await this.run(['get', 'org.gnome.desktop.interface', 'color-scheme'])) === 'prefer-dark' ? 'dark' : 'light';
        let uri = '';
        if (appearance === 'dark') {
            try { uri = parseGvariant(await this.run(['get', 'org.gnome.desktop.background', 'picture-uri-dark'])); } catch { /* Older GNOME has no dark key. */ }
        }
        if (!uri) { uri = parseGvariant(await this.run(['get', 'org.gnome.desktop.background', 'picture-uri'])); }
        if (!uri) { throw new Error('GNOME has no wallpaper image configured'); }
        wallpaperPath(uri);
        return { uri, appearance, provider: this.id };
    }
    watch(changed: () => void, failed: (error: Error) => void): Disposable {
        let disposed = false;
        const children = [
            ['monitor', 'org.gnome.desktop.background'],
            ['monitor', 'org.gnome.desktop.interface', 'color-scheme'],
        ].map(args => {
            const child = spawn('gsettings', args, { stdio: ['ignore', 'pipe', 'ignore'] });
            child.stdout.on('data', () => { if (!disposed) { changed(); } });
            child.on('error', error => { if (!disposed) { failed(error); } });
            child.on('exit', code => { if (!disposed) { failed(new Error(`GNOME monitor stopped (${code}); periodic checks remain active`)); } });
            return child;
        });
        return { dispose: () => { disposed = true; children.forEach(child => child.kill()); } };
    }
}

