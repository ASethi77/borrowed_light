import { parentPort, workerData } from 'node:worker_threads';
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { imagePolicy, sourceByteLimit } from './image/policy';

interface Codec {
    HEAPU8: Uint8Array;
    _normalize(format: number, pixels: number): number;
    _result_pixels(): number;
    _result_width(): number;
    _result_height(): number;
    _result_orientation(): number;
    _result_error(): number;
    UTF8ToString(pointer: number): string;
}
/** EXIF transformations after resizing keep temporary buffers bounded by the thumbnail. */
export function orientPixels(data: Uint8Array, width: number, height: number, orientation: number) {
    if (orientation < 2 || orientation > 8) { return { data: Buffer.from(data), width, height }; }
    const rotated = orientation >= 5;
    const outputWidth = rotated ? height : width, outputHeight = rotated ? width : height;
    const output = Buffer.alloc(data.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let ox = x, oy = y;
            switch (orientation) {
                case 2: ox = width - 1 - x; break;
                case 3: ox = width - 1 - x; oy = height - 1 - y; break;
                case 4: oy = height - 1 - y; break;
                case 5: ox = y; oy = x; break;
                case 6: ox = height - 1 - y; oy = x; break;
                case 7: ox = height - 1 - y; oy = width - 1 - x; break;
                case 8: ox = y; oy = width - 1 - x; break;
            }
            output.set(data.subarray((y * width + x) * 4, (y * width + x + 1) * 4), (oy * outputWidth + ox) * 4);
        }
    }
    return { data: output, width: outputWidth, height: outputHeight };
}

if (parentPort) {
    const port = parentPort;
    void (async () => {
    let descriptor: number | undefined;
    try {
        const policy = imagePolicy(workerData.policy.maxMegapixels);
        descriptor = openSync(workerData.path, 'r');
        const stat = fstatSync(descriptor);
        if (!stat.isFile() || stat.size > sourceByteLimit) { throw new Error('Invalid or oversized wallpaper source'); }
        let consumed = 0;
        const createCodec = require(join(__dirname, 'codec', 'thumbnail.cjs')) as (options: object) => Promise<Codec>;
        const codec = await createCodec({ readSource: (target: Uint8Array) => {
            const length = readSync(descriptor!, target, 0, target.length, null);
            consumed += length;
            if (consumed > stat.size) { throw new Error('Wallpaper changed during decoding'); }
            return length;
        } });
        if (!codec._normalize(workerData.format === 'jpeg' ? 1 : 2, policy.maxMegapixels * 1_000_000)) {
            throw new Error(codec.UTF8ToString(codec._result_error()) || 'Portable decoder allocation failed');
        }
        const width = codec._result_width(), height = codec._result_height(), pointer = codec._result_pixels() >>> 0;
        const image = orientPixels(codec.HEAPU8.subarray(pointer, pointer + width * height * 4), width, height, codec._result_orientation());
        const output = new PNG({ width: image.width, height: image.height }); output.data = image.data;
        const png = Uint8Array.from(PNG.sync.write(output));
        const usage = process.memoryUsage();
        port.postMessage({ png, metrics: { wasmMemoryBytes: codec.HEAPU8.byteLength, heapUsed: usage.heapUsed, external: usage.external, arrayBuffers: usage.arrayBuffers } }, [png.buffer]);
    } catch (error) { port.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
    finally { if (descriptor !== undefined) { closeSync(descriptor); } }
    })();
}
