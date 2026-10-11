import { join } from 'node:path';
import { WallpaperProvider, Wallpaper } from '../contracts';
import { ProcessRunner, runProcess } from '../process';
import { wallpaperUri } from '../../image/source';
import { wallpaperScript } from './scripts';

/** EncodedCommand contains fixed source only, encoded as required UTF-16LE.
 * Image data is supplied through stdin, never concatenated into the command.
 */
export function powershellArguments(script: string): string[] {
    return ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}
export function powershellExecutable(): string {
    return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
export class WindowsProvider implements WallpaperProvider {
    readonly id = 'windows';
    constructor(private readonly run: ProcessRunner = runProcess) {}
    async available(): Promise<boolean> {
        try { await this.run(powershellExecutable(), powershellArguments("[Console]::Write('ready')")); return true; }
        catch { return false; }
    }
    async current(): Promise<Wallpaper> {
        const value: unknown = JSON.parse((await this.run(powershellExecutable(), powershellArguments(wallpaperScript))).toString('utf8'));
        const path = primaryWallpaperPath(value);
        return { uri: wallpaperUri(path), appearance: (value as { appearance: 'light' | 'dark' }).appearance, provider: this.id };
    }
}

interface MonitorBounds { Left: number; Top: number; Right: number; Bottom: number }
function isBounds(value: unknown): value is MonitorBounds {
    return !!value && typeof value === 'object' && ['Left', 'Top', 'Right', 'Bottom'].every(key => key in value && Number.isFinite((value as Record<string, unknown>)[key]));
}
/** Select by actual primary geometry; enumeration order also includes detached displays.
 * This pure boundary parser is testable without a Windows desktop session.
 */
export function primaryWallpaperPath(value: unknown): string {
    if (!value || typeof value !== 'object' || !('primary' in value) || !isBounds(value.primary)
        || !('monitors' in value) || !Array.isArray(value.monitors) || !('appearance' in value) || !['light', 'dark'].includes(String(value.appearance))) {
        throw new Error('Invalid Windows wallpaper response');
    }
    const primary = value.primary;
    const monitor = value.monitors.find((candidate: unknown) => {
        if (!candidate || typeof candidate !== 'object' || !('bounds' in candidate) || !isBounds(candidate.bounds)) { return false; }
        const bounds = candidate.bounds;
        return bounds.Left === primary.Left && bounds.Top === primary.Top && bounds.Right === primary.Right && bounds.Bottom === primary.Bottom;
    });
    if (!monitor) { throw new Error('No wallpaper monitor matches the primary display'); }
    if (typeof monitor.path !== 'string') { throw new Error('Invalid Windows wallpaper path'); }
    if (!monitor.path) { throw new Error('Windows primary display has no wallpaper image configured (solid colors are unsupported)'); }
    return monitor.path;
}
