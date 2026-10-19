import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import * as jpeg from 'jpeg-js';
import { deflateSync } from 'node:zlib';
import { portableImageDecoder } from '../../image/portable';
import { decodePixels } from '../../image/decode';
import { imagePolicy } from '../../image/policy';
import { orientPixels } from '../../thumbnail-worker';
import { runPipeline } from '../../pipeline';
import { nativeImageDecoder } from '../../platform/os_wallpaper';
import { extractRepresentativeColors } from '../../color/extraction';

const decoder = () => portableImageDecoder(resolve('dist/thumbnail-worker.js'));
const signal = () => new AbortController().signal;
function chunk(type: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) { crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } }
    const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length); body.copy(output, 4); output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4); return output;
}
/** Small, independently encoded Adam7 fixture with a distinct value at every pixel. */
function interlacedPng() {
    const width = 9, height = 7, pixels = Buffer.alloc(width * height * 4), rows: Buffer[] = [];
    const xs = [0,4,0,2,0,1,0], ys = [0,0,4,0,2,0,1], dx = [8,8,4,4,2,2,1], dy = [8,8,8,4,4,2,2];
    for (let y = 0; y < height; y++) { for (let x = 0; x < width; x++) { pixels.set([x * 20,y * 30,40,255], (y * width + x) * 4); } }
    for (let pass = 0; pass < 7; pass++) {
        for (let y = ys[pass]; y < height; y += dy[pass]) {
            const row = [0];
            for (let x = xs[pass]; x < width; x += dx[pass]) { row.push(...pixels.subarray((y * width + x) * 4, (y * width + x + 1) * 4)); }
            if (row.length > 1) { rows.push(Buffer.from(row)); }
        }
    }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[12] = 1;
    return { pixels, png: Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]) };
}

test('portable packaged codecs decode JPEG/PNG and Adam7 with exact alpha and pixel placement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-codec-'));
    try {
        const path = join(directory, "wallpaper 'é' $.image");
        const interlace = interlacedPng(); await writeFile(path, interlace.png);
        assert.deepEqual(Buffer.from(decodePixels(await decoder().fromFile!(path, signal())).data), interlace.pixels);
        const input = new PNG({ width: 2, height: 1 }); input.data = Buffer.from([10,20,30,128,200,100,50,255]);
        await writeFile(path, PNG.sync.write(input));
        assert.deepEqual(Buffer.from(decodePixels(await decoder().fromFile!(path, signal())).data), input.data);
        input.data.fill(255); await writeFile(path, jpeg.encode(input, 90).data);
        const jpegImage = decodePixels(await decoder().fromFile!(path, signal()));
        assert.equal(jpegImage.width, 2); assert.ok(jpegImage.data[0] >= 250);
        const result = await runPipeline(resolve('dist/palette-worker.js'), path, 'analogous', 'dark', undefined, 'automatic', 'balanced', undefined, 'vibrant', undefined, { decoderMode: 'portable' });
        assert.ok(result.swatches.length);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('portable resizing respects source limit and preserves opacity-weighted colors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-resize-'));
    try {
        const path = join(directory, 'wide.png');
        const image = new PNG({ width: 2048, height: 1024 });
        for (let i = 0; i < image.data.length; i += 4) { image.data.set([34,153,68,128], i); }
        await writeFile(path, PNG.sync.write(image));
        await assert.rejects(decoder().fromFile!(path, signal(), imagePolicy(1)), /1 megapixel/);
        const result = decodePixels(await decoder().fromFile!(path, signal()));
        assert.equal(result.width, 1024); assert.equal(result.height, 512); assert.deepEqual([...result.data.subarray(0,4)], [34,153,68,128]);
        const abort = new AbortController(); abort.abort();
        await assert.rejects(decoder().fromFile!(path, abort.signal), /cancelled/);
        const active = new AbortController(); const pending = decoder().fromFile!(path, active.signal);
        setTimeout(() => active.abort(), 10);
        await assert.rejects(pending, /cancelled/);
        const bytes = await readFile(path); await writeFile(path, bytes.subarray(0, bytes.length - 15));
        await assert.rejects(decoder().fromFile!(path, signal()), /PNG|Truncated/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('all EXIF orientations place distinct pixels correctly', () => {
    const pixels = Buffer.from([1,0,0,255,2,0,0,255,3,0,0,255,4,0,0,255,5,0,0,255,6,0,0,255]);
    const expected = [[1,2,3,4,5,6],[2,1,4,3,6,5],[6,5,4,3,2,1],[5,6,3,4,1,2],[1,3,5,2,4,6],[5,3,1,6,4,2],[6,4,2,5,3,1],[2,4,6,1,3,5]];
    for (let value = 1; value <= 8; value++) {
        const result = orientPixels(pixels, 2, 3, value);
        assert.equal(result.width, value >= 5 ? 3 : 2);
        assert.deepEqual([...result.data].filter((_byte, index) => index % 4 === 0), expected[value - 1]);
    }
});

test('native and portable normalized palettes meet common color and region-weight tolerances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-parity-'));
    try {
        const path = join(directory, 'regions.png');
        const image = new PNG({ width:2048, height:1024 });
        const colors = [[200,20,20,255],[20,200,20,128],[20,20,200,255]];
        for (let y=0;y<1024;y++) { for (let x=0;x<2048;x++) { image.data.set(colors[x<1024?0:y<512?1:2], (y*2048+x)*4); } }
        await writeFile(path, PNG.sync.write(image));
        const native = nativeImageDecoder();
        for (const backend of [decoder(), ...(native?[native]:[])]) {
            await assert.rejects(backend.fromFile!(path, signal(), imagePolicy(1)), /megapixel/);
            const pixels = decodePixels(await backend.fromFile!(path, signal()));
            const swatches = extractRepresentativeColors(pixels.data, pixels.width, pixels.height);
            for (const [index,color] of colors.entries()) {
                const match = swatches.find(swatch => {
                    const rgb = [1,3,5].map(offset=>parseInt(swatch.hex.slice(offset,offset+2),16));
                    return rgb.every((value,channel)=>Math.abs(value-color[channel])<=5);
                });
                assert.ok(match, `${backend.id}: region ${index}`);
                assert.ok(Math.abs(match.weight-[4/7,1/7,2/7][index])<=0.03, `${backend.id}: region weight ${index}`);
            }
        }
    } finally { await rm(directory,{recursive:true,force:true}); }
});

test('portable codec supports grayscale, palette transparency and 16-bit PNG inputs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-png-types-'));
    try {
        const cases = [
            { depth:1, type:0, width:2, raw:Buffer.from([0,64]), extra:Buffer.alloc(0), expected:[0,0,0,255,255,255,255,255] },
            { depth:8, type:3, width:1, raw:Buffer.from([0,0]), extra:Buffer.concat([chunk('PLTE',Buffer.from([34,153,68])),chunk('tRNS',Buffer.from([128]))]), expected:[34,153,68,128] },
            { depth:16, type:6, width:1, raw:Buffer.from([0,128,128,64,64,32,32,255,255]), extra:Buffer.alloc(0), expected:[128,64,32,255] },
        ];
        for (const [index,input] of cases.entries()) {
            const header = Buffer.alloc(13); header.writeUInt32BE(input.width);header.writeUInt32BE(1,4);header[8]=input.depth;header[9]=input.type;
            const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),input.extra,chunk('IDAT',deflateSync(input.raw)),chunk('IEND',Buffer.alloc(0))]);
            const path=join(directory,`${index}.png`);await writeFile(path,bytes);
            assert.deepEqual([...decodePixels(await decoder().fromFile!(path,signal())).data],input.expected);
        }
    } finally { await rm(directory,{recursive:true,force:true}); }
});

test('JPEG EXIF metadata is applied by the packaged portable decoder', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-exif-'));
    try {
        const pixels = Buffer.from([20,20,20,255,50,50,50,255,80,80,80,255,110,110,110,255,140,140,140,255,170,170,170,255]);
        const bytes = jpeg.encode({ data:pixels,width:2,height:3 },100).data;
        for (let orientation=1;orientation<=8;orientation++) {
            const exif = Buffer.alloc(32);exif.write('Exif\0\0',0,'binary');exif.write('II',6);exif.writeUInt16LE(42,8);exif.writeUInt32LE(8,10);
            exif.writeUInt16LE(1,14);exif.writeUInt16LE(274,16);exif.writeUInt16LE(3,18);exif.writeUInt32LE(1,20);exif.writeUInt16LE(orientation,24);
            const path=join(directory,`${orientation}.jpg`);
            await writeFile(path,Buffer.concat([bytes.subarray(0,2),Buffer.from([255,225,0,34]),exif,bytes.subarray(2)]));
            const result=decodePixels(await decoder().fromFile!(path,signal()));
            const expected=orientPixels(pixels,2,3,orientation);
            assert.equal(result.width,expected.width);assert.equal(result.height,expected.height);
            assert.ok([...result.data].every((value,index)=>Math.abs(value-expected.data[index])<=3));
        }
    } finally {await rm(directory,{recursive:true,force:true});}
});
