import { parentPort, workerData } from 'node:worker_threads';
import { open } from 'node:fs/promises';
import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { extract } from './colors';
import { PipelineInput } from './model';
import { generateVariant, generateVariants } from './variants';

export const maxBytes = 64 * 1024 * 1024;
export const maxPixels = 32_000_000;
export async function decodeImage(path: string): Promise<{ data: Uint8Array; width: number; height: number }> {
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
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.subarray(0, 8).equals(pngSignature)) {
        if (bytes.length < 24) { throw new Error('Truncated PNG'); }
        const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
        if (!width || !height || width * height > maxPixels) { throw new Error('Wallpaper exceeds the 32 megapixel limit'); }
        return PNG.sync.read(bytes);
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        return jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 32, maxMemoryUsageInMB: 512, tolerantDecoding: false });
    }
    throw new Error('Unsupported wallpaper format. V1 supports JPEG and PNG; WebP, SVG, JXL, and GNOME XML slideshows are not supported.');
}

if (parentPort) {
    const port = parentPort;
    const input = workerData as PipelineInput;
    void (async () => {
        try {
            let swatches = input.swatches;
            if (!swatches) {
                if (!input.path) { throw new Error('No wallpaper source'); }
                const image = await decodeImage(input.path);
                swatches = extract(image.data, image.width, image.height);
            }
            port.postMessage({ result: input.previews ? generateVariants(swatches) : generateVariant(swatches, input.harmony!, input.appearance!) });
        } catch (error) { port.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
        finally { port.close(); }
    })();
}
