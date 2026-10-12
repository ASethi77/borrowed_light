import { PrimaryChoices } from './model';

interface PreferenceState {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): PromiseLike<void>;
}
const sourceKey = 'primaryWallpaper.v1';

/** Primary slots belong to one wallpaper, independently of appearance and syntax.
 * Remember only successful syncs/accepted previews, so failed or cancelled work
 * cannot consume a wallpaper change. An unbound existing preference is migrated
 * on the first successful sync rather than silently discarding it on upgrade.
 */
export class WallpaperPrimaries {
    constructor(private readonly state: PreferenceState) {}
    resolve(sourceSignature: string, requested: PrimaryChoices): { primaries: PrimaryChoices; reset: boolean } {
        const previous = this.state.get<string>(sourceKey);
        const reset = previous !== undefined && previous !== sourceSignature;
        return { primaries: reset ? { dark: 'automatic', light: 'automatic' } : { ...requested }, reset };
    }
    async remember(sourceSignature: string): Promise<void> {
        await this.state.update(sourceKey, sourceSignature);
    }
}
