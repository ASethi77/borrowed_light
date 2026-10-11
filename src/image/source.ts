import { fileURLToPath, pathToFileURL } from 'node:url';

/** Node's native file-URL conversion handles percent escapes, drive letters and UNC
 * hosts on Windows, and rejects remote hosts on POSIX. No shell path parsing is involved.
 */
export function wallpaperPath(uri: string): string {
    const url = new URL(uri);
    if (url.protocol !== 'file:') { throw new Error('Only local file:// wallpapers are supported'); }
    return fileURLToPath(url);
}
export function wallpaperUri(path: string): string { return pathToFileURL(path).href; }
