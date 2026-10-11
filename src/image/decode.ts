import { open } from 'node:fs/promises';
import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { NativeImageDecoder } from '../platform/contracts';
import { maxBytes, maxPixels } from './limits';
export { maxBytes, maxPixels } from './limits';

export interface ImagePixels { data: Uint8Array; width: number; height: number }
export class UnsupportedImageFormat extends Error { constructor() { super('Unsupported wallpaper format on this platform. JPEG/PNG work everywhere; native codecs support additional still images on Windows/macOS.'); } }
export async function readImageBytes(path: string): Promise<Buffer> {
    const file = await open(path, 'r');
    let bytes: Buffer;
    try {
        const stat = await file.stat();
        if (!stat.isFile()) { throw new Error('Wallpaper is not a regular file'); }
        if (stat.size > maxBytes) { throw new Error('Wallpaper exceeds the 64 MiB input limit'); }
        bytes = Buffer.alloc(stat.size + 1);
        let offset = 0;
        while (offset < bytes.length) {
            const read = await file.read(bytes, offset, bytes.length - offset, offset);
            if (!read.bytesRead) { break; }
            offset += read.bytesRead;
        }
        if (offset > stat.size) { throw new Error('Wallpaper changed during decoding; try syncing again'); }
        bytes = bytes.subarray(0, offset);
    } finally { await file.close(); }
    return bytes;
}

/** Signature detection, not filename extensions: OS caches may have extensionless files. */
export function decodePixels(bytes: Uint8Array): ImagePixels {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength > maxBytes) { throw new Error('Wallpaper exceeds the 64 MiB input limit'); }
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (buffer.subarray(0, 8).equals(pngSignature)) {
        if (bytes.length < 24) { throw new Error('Truncated PNG'); }
        const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
        if (!width || !height || width * height > maxPixels) { throw new Error('Wallpaper exceeds the 32 megapixel limit'); }
        return PNG.sync.read(buffer);
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        return jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 32, maxMemoryUsageInMB: 512, tolerantDecoding: false });
    }
    throw new UnsupportedImageFormat();
}

/** Portable formats retain their exact existing decoder behavior. Native fallback is
 * explicit and only attempted for unknown formats, never to mask corrupt JPEG/PNG.
 */
export async function decodeImage(path: string, native?: NativeImageDecoder, signal: AbortSignal = new AbortController().signal): Promise<ImagePixels> {
    const bytes = await readImageBytes(path);
    try { return decodePixels(bytes); }
    catch (error) {
        if (!(error instanceof UnsupportedImageFormat) || !native) { throw error; }
        const normalized = await native(bytes, signal);
        if (normalized.byteLength > maxBytes) { throw new Error('Normalized wallpaper exceeds the 64 MiB output limit'); }
        if (!Buffer.from(normalized.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { throw new Error('Native decoder returned invalid PNG data'); }
        return decodePixels(normalized);
    }
}
