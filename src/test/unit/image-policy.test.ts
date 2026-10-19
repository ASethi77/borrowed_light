import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import * as jpeg from 'jpeg-js';
import { imagePolicy, checkDimensions, sourceByteLimit } from '../../image/policy';
import { inspectSource } from '../../image/metadata';

test('source policy has identical exact boundaries and validates configuration', () => {
    assert.deepEqual(imagePolicy(), { maxMegapixels: 256 });
    for (const invalid of [0, 513, 1.5, NaN, Infinity]) { assert.throws(() => imagePolicy(invalid), /integer/); }
    checkDimensions(32000, 16000, imagePolicy(512));
    checkDimensions(16000, 16000, imagePolicy());
    assert.throws(() => checkDimensions(16001, 16000, imagePolicy()), /256 megapixel/);
    assert.throws(() => checkDimensions(32001, 16000, imagePolicy(512)), /512 megapixel/);
    assert.throws(() => checkDimensions(65536, 1, imagePolicy(512)), /edge/);
    assert.throws(() => checkDimensions(0, 1, imagePolicy()), /dimensions/);
});

test('bounded signature inspection handles JPEG/PNG, literal paths, malformed and sparse oversized sources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-policy-'));
    try {
        const path = join(directory, "source 'é' $.data");
        const image = new PNG({ width: 2, height: 3 }); image.data.fill(128);
        await writeFile(path, PNG.sync.write(image));
        const png = await inspectSource(path);
        assert.equal(png.format, 'png'); assert.equal(png.width, 2); assert.equal(png.height, 3);
        await writeFile(path, jpeg.encode(image, 90).data);
        const jpg = await inspectSource(path);
        assert.equal(jpg.format, 'jpeg'); assert.equal(jpg.width, 2); assert.equal(jpg.height, 3);
        await writeFile(path, Buffer.from([255,216,255,224,0,1]));
        await assert.rejects(inspectSource(path), /Truncated/);
        await writeFile(path, Buffer.from([137,80,78,71,13,10,26,10]));
        await assert.rejects(inspectSource(path), /PNG/);
        const file = await open(path, 'w');
        try { await file.truncate(sourceByteLimit + 1); } finally { await file.close(); }
        await assert.rejects(inspectSource(path), /2 GiB/);
        await assert.rejects(inspectSource(directory), /regular file|EISDIR|EPERM/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
