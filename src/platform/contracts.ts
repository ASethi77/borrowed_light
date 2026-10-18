import type { Appearance } from '../model';

export interface Wallpaper { uri: string; appearance: Appearance; provider: string }
export interface Disposable { dispose(): void }
export interface WallpaperProvider {
    readonly id: string;
    available(): Promise<boolean>;
    current(): Promise<Wallpaper>;
    /** Read system mode without resolving or opening the wallpaper. */
    appearance(): Promise<Appearance>;
    watch?(changed: () => void, failed: (error: Error) => void): Disposable;
    /** Safety checks when an event monitor is healthy; failures use the default interval. */
    readonly pollIntervalMs?: number;
}
/** Convert bounded source bytes to PNG. Process ownership stays in the extension host,
 * so worker termination cannot orphan an OS helper. The signal covers the whole job.
 */
export interface NativeImageDecoder {
    (bytes: Uint8Array, signal: AbortSignal): Promise<Uint8Array>;
    /** Normalize directly from a local file without loading a large source into the worker. */
    fromFile?(path: string, signal: AbortSignal): Promise<Uint8Array>;
}
