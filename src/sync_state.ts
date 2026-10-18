import { isHexColorCode } from './color/code';
import { Swatch, Wallpaper } from './model';

export interface LocalState {
    keys(): readonly string[];
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): PromiseLike<void>;
}
export const installationKey = 'installation.v1';
export function installationKind(state: LocalState, hasExplicitPreferences: boolean): 'fresh' | 'existing' | 'initialized' {
    if (state.get(installationKey)) { return 'initialized'; }
    return state.keys().length || hasExplicitPreferences ? 'existing' : 'fresh';
}
export interface WallpaperSnapshot { wallpaper: Wallpaper; sourceSignature: string; swatches: Swatch[] }
const snapshotKey = 'wallpaperSnapshot.v1';

/** Store colors, not wallpaper bytes. Appearance-only updates survive restart and a
 * deleted/replaced source image without accidentally adopting a different wallpaper.
 */
export class WallpaperSnapshots {
    constructor(private readonly state: LocalState) {}
    read(): WallpaperSnapshot | undefined {
        const saved = this.state.get<WallpaperSnapshot>(snapshotKey);
        if (!saved || typeof saved.sourceSignature !== 'string' || !saved.wallpaper ||
            typeof saved.wallpaper.uri !== 'string' || typeof saved.wallpaper.provider !== 'string' ||
            !['light', 'dark'].includes(saved.wallpaper.appearance) || !Array.isArray(saved.swatches) ||
            !saved.swatches.length || saved.swatches.length > 8 || saved.swatches.some(swatch => !swatch ||
                !isHexColorCode(swatch.hex) || !Number.isFinite(swatch.weight) || swatch.weight <= 0)) { return undefined; }
        return saved;
    }
    async remember(snapshot: WallpaperSnapshot): Promise<void> { await this.state.update(snapshotKey, snapshot); }
}
export type SyncIndicatorState = 'Off' | 'Paused' | 'Syncing' | 'Error' | 'On';
export function syncIndicatorState(enabled: boolean, active: boolean, busy: boolean, error: string): SyncIndicatorState {
    return !enabled ? 'Off' : busy ? 'Syncing' : error ? 'Error' : !active ? 'Paused' : 'On';
}
