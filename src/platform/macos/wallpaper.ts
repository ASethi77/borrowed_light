import { WallpaperProvider, Wallpaper } from '../contracts';
import { ProcessRunner, runProcess } from '../process';
import { wallpaperPath } from '../../image/source';
import { wallpaperScript } from './scripts';

export function osascriptArguments(script: string): string[] { return ['-l', 'JavaScript', '-e', script]; }
export class MacosProvider implements WallpaperProvider {
    readonly id = 'macos';
    constructor(private readonly run: ProcessRunner = runProcess) {}
    async available(): Promise<boolean> {
        try { await this.run('/usr/bin/osascript', osascriptArguments("'ready'")); return true; }
        catch { return false; }
    }
    async current(): Promise<Wallpaper> {
        const value: unknown = JSON.parse((await this.run('/usr/bin/osascript', osascriptArguments(wallpaperScript))).toString('utf8'));
        if (!value || typeof value !== 'object' || !('uri' in value) || typeof value.uri !== 'string' || !('appearance' in value) || !['light', 'dark'].includes(String(value.appearance))) {
            throw new Error('Invalid macOS wallpaper response');
        }
        wallpaperPath(value.uri);
        return { uri: value.uri, appearance: value.appearance as 'light' | 'dark', provider: this.id };
    }
}
