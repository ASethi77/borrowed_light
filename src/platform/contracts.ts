import type { Appearance } from '../model';

export interface Wallpaper { uri: string; appearance: Appearance; provider: string }
export interface Disposable { dispose(): void }
export interface WallpaperProvider {
    readonly id: string;
    available(): Promise<boolean>;
    current(): Promise<Wallpaper>;
    watch?(changed: () => void, failed: (error: Error) => void): Disposable;
}
/** Convert bounded source bytes to PNG. Process ownership stays in the extension host,
 * so worker termination cannot orphan an OS helper. The signal covers the whole job.
 */
export type NativeImageDecoder = (bytes: Uint8Array, signal: AbortSignal) => Promise<Uint8Array>;
