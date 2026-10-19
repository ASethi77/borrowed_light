import { open } from 'node:fs/promises';
import { ImagePolicy, checkDimensions, imagePolicy, sourceByteLimit } from './policy';

export interface SourceMetadata { format: 'jpeg' | 'png' | 'native'; width?: number; height?: number; bytes: number; fingerprint: string }
/** Read bounded headers from the same descriptor; never load the compressed raster. */
export async function inspectSource(path: string, policy: ImagePolicy = imagePolicy()): Promise<SourceMetadata> {
    imagePolicy(policy.maxMegapixels);
    const file = await open(path, 'r');
    try {
        const stat = await file.stat();
        if (!stat.isFile()) { throw new Error('Wallpaper is not a regular file'); }
        if (stat.size > sourceByteLimit) { throw new Error('Wallpaper exceeds the 2 GiB input limit'); }
        const read = async (position: number, length: number) => {
            const bytes = Buffer.alloc(length);
            if ((await file.read(bytes, 0, length, position)).bytesRead !== length) { throw new Error('Truncated wallpaper header'); }
            return bytes;
        };
        const start = await read(0, Math.min(24, stat.size));
        let format: SourceMetadata['format'] = 'native', width: number | undefined, height: number | undefined;
        if (start.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
            format = 'png';
            if (start.length < 24 || start.toString('ascii', 12, 16) !== 'IHDR') { throw new Error('Truncated or invalid PNG header'); }
            width = start.readUInt32BE(16); height = start.readUInt32BE(20);
        } else if (start[0] === 255 && start[1] === 216) {
            format = 'jpeg';
            let position = 2;
            // JPEG marker segments are at most 64 KiB. Bound header traversal too.
            while (position < Math.min(stat.size, 16 * 1024 * 1024)) {
                if ((await read(position++, 1))[0] !== 255) { throw new Error('Invalid JPEG marker'); }
                let marker = (await read(position++, 1))[0];
                while (marker === 255) { marker = (await read(position++, 1))[0]; }
                if (marker === 217 || marker === 218) { break; }
                if (marker === 1 || (marker >= 208 && marker <= 215)) { continue; }
                const length = (await read(position, 2)).readUInt16BE();
                if (length < 2 || position + length > stat.size) { throw new Error('Truncated JPEG segment'); }
                if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
                    if (length < 8) { throw new Error('Invalid JPEG dimensions'); }
                    const dimensions = await read(position + 3, 4);
                    height = dimensions.readUInt16BE(); width = dimensions.readUInt16BE(2); break;
                }
                position += length;
            }
            if (width === undefined) { throw new Error('Cannot read JPEG dimensions within bounded header'); }
        }
        if (width !== undefined && height !== undefined) { checkDimensions(width, height, policy); }
        return { format, width, height, bytes: stat.size, fingerprint: JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino]) };
    } finally { await file.close(); }
}
