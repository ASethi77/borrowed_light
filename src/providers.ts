import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Wallpaper, WallpaperProvider, Disposable } from './model';

export type Run = (args: string[]) => Promise<string>;
export const runGsettings: Run = args => new Promise((resolve, reject) => {
    execFile('gsettings', args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error) { reject(new Error(`Cannot read GNOME settings: ${error.message}`)); } else { resolve(stdout.trim()); }
    });
});

/** GSettings prints a GVariant quoted string, not a shell expression. Never evaluate it. */
export function parseGvariant(input: string): string {
    const value = input.trim();
    const quote = value[0];
    if ((quote !== "'" && quote !== '"') || value.at(-1) !== quote) { throw new Error('Invalid GSettings string'); }
    let result = '';
    for (let i = 1; i < value.length - 1; i++) {
        if (value[i] === quote) { throw new Error('Unescaped quote in GSettings string'); }
        if (value[i] !== '\\') { result += value[i]; continue; }
        const escaped = value[++i];
        if (i >= value.length - 1) { throw new Error('Unterminated GSettings escape'); }
        const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', "'": "'", '"': '"' };
        if (escaped in simple) { result += simple[escaped]; }
        else if (escaped === 'u' || escaped === 'U' || escaped === 'x') {
            const length = escaped === 'u' ? 4 : escaped === 'U' ? 8 : 2;
            const digits = value.slice(i + 1, i + 1 + length);
            if (digits.length !== length || !/^[\da-f]+$/i.test(digits)) { throw new Error('Invalid GSettings escape'); }
            result += String.fromCodePoint(parseInt(digits, 16)); i += length;
        } else { throw new Error('Unknown GSettings escape'); }
    }
    return result;
}

export function wallpaperPath(uri: string): string {
    const url = new URL(uri);
    if (url.protocol !== 'file:') { throw new Error('Only local file:// wallpapers are supported'); }
    return fileURLToPath(url);
}

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

export class UnsupportedProvider implements WallpaperProvider {
    readonly id = 'unsupported';
    async available(): Promise<boolean> { return true; }
    async current(): Promise<Wallpaper> { throw new Error('Borrowed Light currently supports local Fedora/GNOME sessions. This desktop has no wallpaper provider yet.'); }
}

export interface ProviderRegistration { matches(platform: NodeJS.Platform, desktop: string): boolean; create(): WallpaperProvider }
export const providerRegistry: ProviderRegistration[] = [
    { matches: (platform, desktop) => platform === 'linux' && desktop.toLowerCase().includes('gnome'), create: () => new GnomeProvider() },
];
export async function selectProvider(platform = process.platform, desktop = process.env.XDG_CURRENT_DESKTOP ?? process.env.DESKTOP_SESSION ?? ''): Promise<WallpaperProvider> {
    for (const registration of providerRegistry) {
        if (registration.matches(platform, desktop)) {
            const provider = registration.create();
            if (await provider.available()) { return provider; }
        }
    }
    return new UnsupportedProvider();
}
