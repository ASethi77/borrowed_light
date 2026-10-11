import { parseHexColorCode } from '../../color/code';
import { generateVariant } from '../../variants';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import * as jpeg from 'jpeg-js';
import { decodeImage } from '../../image/decode';
import { Cancelled, runPipeline, runPreviews, runVariant } from '../../pipeline';
import { harmonies } from '../../model';
import { reportHtml } from '../../report';

const makeImage = () => {
    const image = new PNG({ width: 2, height: 2 });
    image.data = Buffer.from([20,130,180,255, 20,130,180,255, 210,110,50,255, 200,200,200,255]);
    return image;
};
test('JPEG/PNG decode and packaged worker round-trip; paths need no shell escaping', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-'));
    const pngPath = join(directory, "wallpaper 'é'.png"), jpegPath = join(directory, 'wallpaper.jpg');
    await writeFile(pngPath, PNG.sync.write(makeImage()));
    await writeFile(jpegPath, jpeg.encode(makeImage(), 90).data);
    assert.equal((await decodeImage(pngPath)).width, 2);
    assert.equal((await decodeImage(jpegPath)).height, 2);
    const result = await runPipeline(resolve('dist/palette-worker.js'), pngPath, harmonies[0], 'dark');
    assert.equal(result.palette.length, 5);
    assert.ok(result.theme.checks.every(check => check.ratio >= check.minimum));
    const previews = await runPreviews(resolve('dist/palette-worker.js'), { path: pngPath });
    const reused = await runPreviews(resolve('dist/palette-worker.js'), { swatches: result.swatches });
    assert.deepEqual(previews, reused);
    const chosen = await runVariant(resolve('dist/palette-worker.js'), result.swatches, 'analogous', 'light', 'wallpaper-2');
    assert.equal(chosen.primary.hex, result.swatches[1].hex);
    const vibrant = await runVariant(resolve('dist/palette-worker.js'), result.swatches, 'analogous', 'light', 'wallpaper-2', undefined, 'vibrant');
    assert.equal(vibrant.syntaxStyle, 'vibrant');
    assert.deepEqual(vibrant.theme.colors, chosen.theme.colors);
    assert.notDeepEqual(vibrant.theme.semanticRules, chosen.theme.semanticRules);
    const separate = await runPreviews(resolve('dist/palette-worker.js'), { swatches: result.swatches }, undefined, { dark: 'wallpaper-1', light: 'wallpaper-2' });
    assert.equal(separate.analogous.dark.primary.hex, result.swatches[0].hex);
    assert.equal(separate.analogous.light.primary.hex, result.swatches[1].hex);
    for (const harmony of harmonies) {
        for (const appearance of ['light', 'dark'] as const) {
            assert.equal(previews[harmony][appearance].theme.appearance, appearance);
            assert.deepEqual(previews[harmony][appearance].swatches, result.swatches);
            assert.ok(previews[harmony][appearance].theme.checks.every(check => check.ratio >= check.minimum));
        }
    }
    const html = reportHtml(result, { uri: 'file:///tmp/<script>alert(1)</script>.png', provider: 'test', appearance: 'dark' }, 'analogous', ['<img onerror="bad">']);
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('Content-Security-Policy'));
});
test('malformed, unsupported, oversized PNG and missing files reject without applying anything', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-errors-'));
    const path = join(directory, 'wallpaper.png');
    await writeFile(path, '<background><static/></background>');
    await assert.rejects(decodeImage(path), /Unsupported/);
    await writeFile(path, Buffer.from([137,80,78,71,13,10,26,10]));
    await assert.rejects(decodeImage(path), /Truncated/);
    const large = PNG.sync.write(makeImage()); large.writeUInt32BE(100000000, 16);
    await writeFile(path, large);
    await assert.rejects(decodeImage(path), /megapixel/);
    await assert.rejects(decodeImage(join(directory, 'missing')), /ENOENT/);
    await assert.rejects(runPipeline(resolve('dist/palette-worker.js'), path, 'analogous', 'dark'), /megapixel/);
});
test('cancelled and superseded worker generations cannot return stale results', async () => {
    const abort = new AbortController(); abort.abort();
    await assert.rejects(runPipeline(resolve('dist/palette-worker.js'), join(tmpdir(), 'borrowed-light-unused'), 'analogous', 'dark', abort.signal), Cancelled);
    const active = new AbortController();
    const pending = runPipeline(resolve('dist/palette-worker.js'), join(tmpdir(), 'borrowed-light-unused'), 'analogous', 'dark', active.signal);
    active.abort();
    await assert.rejects(pending, Cancelled);
});
test('worker errors and deadlines reject and terminate processing', async context => {
    await assert.rejects(runPipeline(resolve('dist/nonexistent-worker.js'), join(tmpdir(), 'borrowed-light-unused'), 'analogous', 'dark'), /Cannot find module/);
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = runPipeline(resolve('dist/palette-worker.js'), join(tmpdir(), 'borrowed-light-unused'), 'analogous', 'dark');
    context.mock.timers.tick(15000);
    await assert.rejects(pending, /exceeded 15 seconds/);
    context.mock.timers.reset();
});

test('worker validates reused swatch colors after structured cloning', async () => {
    const { Worker } = await import('node:worker_threads');
    for (const hex of ['#abc', '#12345678', 'red', '#xyz123']) {
        const reply = await new Promise<{ error: string }>((resolveReply, reject) => {
            const worker = new Worker(resolve('dist/palette-worker.js'), { workerData: { swatches: [{ hex, weight: 1 }], harmony: 'analogous', appearance: 'light' } });
            worker.once('message', resolveReply);
            worker.once('error', reject);
        });
        assert.match(reply.error, /Invalid opaque hex color/);
    }
});

test('report guards raw customizations before contrast calculations and escapes unsupported formats', async () => {
    const result = generateVariant([{ hex: parseHexColorCode('#2244bb'), weight: 1 }], 'analogous', 'light');
    const html = reportHtml(result, { uri: 'file:///wallpaper.png', provider: 'test', appearance: 'light' }, 'analogous', [], {
        'editor.background': '#Ab12CD', 'editor.foreground': '#11223344',
        'button.background': '#abc', 'button.foreground': 'red', 'input.foreground': '<img onerror="bad">',
    });
    assert.ok(html.includes('background:#Ab12CD;color:'));
    for (const value of ['#11223344', '#abc', 'red', '&lt;img onerror=&quot;bad&quot;&gt;']) { assert.ok(html.includes(`<code>${value}</code>`)); }
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('Extracted-color contrast matrix'));
});

test('native fallback round-trip is parent-owned and only runs for unknown formats', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-native-'));
    const path = join(directory, 'wallpaper.native');
    const source = Buffer.from('unknown native format');
    const png = PNG.sync.write(makeImage());
    await writeFile(path, source);
    let called = 0;
    const decoder = async (bytes: Uint8Array, signal: AbortSignal) => {
        assert.deepEqual(Buffer.from(bytes), source);
        assert.equal(signal.aborted, false); called++;
        return png;
    };
    const worker = resolve('dist/palette-worker.js');
    const result = await runPipeline(worker, path, 'analogous', 'light', undefined, 'automatic', 'balanced', decoder);
    assert.ok(result.swatches.length); assert.equal(called, 1);
    const previews = await runPreviews(worker, { path }, undefined, undefined, 'balanced', decoder);
    assert.deepEqual(previews.analogous.light, result); assert.equal(called, 2);
    await writeFile(path, png);
    await runPipeline(worker, path, 'analogous', 'light', undefined, 'automatic', 'balanced', decoder);
    assert.equal(called, 2, 'portable formats bypass OS helpers');
    await writeFile(path, Buffer.from([137,80,78,71,13,10,26,10]));
    await assert.rejects(runPipeline(worker, path, 'analogous', 'light', undefined, 'automatic', 'balanced', decoder), /Truncated/);
    assert.equal(called, 2, 'corrupt known formats do not fall back');
});
test('native helper errors, invalid replies and cancellation cannot return a stale palette', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-native-errors-'));
    const path = join(directory, 'wallpaper.native');
    await writeFile(path, 'unknown native format');
    const worker = resolve('dist/palette-worker.js');
    await assert.rejects(runPipeline(worker, path, 'analogous', 'light', undefined, 'automatic', 'balanced', async () => { throw new Error('codec blocked'); }), /codec blocked/);
    await assert.rejects(runPipeline(worker, path, 'analogous', 'light', undefined, 'automatic', 'balanced', async () => Buffer.from('bad reply')), /invalid PNG/);
    await assert.rejects(runPipeline(worker, path, 'analogous', 'light', undefined, 'automatic', 'balanced', async () => new Uint8Array(64 * 1024 * 1024 + 1)), /size|limit/);
    const abort = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolveReady => { started = resolveReady; });
    let helperSignal: AbortSignal | undefined;
    const pending = runPipeline(worker, path, 'analogous', 'light', abort.signal, 'automatic', 'balanced', async (_bytes, signal) => {
        helperSignal = signal; started();
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('helper cancelled')), { once: true }));
    });
    const rejected = assert.rejects(pending, Cancelled);
    await ready; abort.abort(); await rejected;
    assert.ok(helperSignal?.aborted);
});

test('job deadline and worker crashes abort an outstanding native conversion', async context => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-native-stop-'));
    const path = join(directory, 'image.native');
    await writeFile(path, 'native format');
    let helperSignal: AbortSignal | undefined;
    let started!: () => void;
    const ready = new Promise<void>(resolveReady => { started = resolveReady; });
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = runPipeline(resolve('dist/palette-worker.js'), path, 'analogous', 'light', undefined, 'automatic', 'balanced', async (_bytes, signal) => {
        helperSignal = signal; started();
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    });
    const rejected = assert.rejects(pending, /exceeded 15 seconds/);
    try { await ready; context.mock.timers.tick(15000); await rejected; assert.ok(helperSignal?.aborted); }
    finally { context.mock.timers.reset(); }
    const crashedWorker = join(directory, 'crash.cjs');
    await writeFile(crashedWorker, "const {parentPort}=require('node:worker_threads');parentPort.postMessage({nativeDecode:new Uint8Array([1])});setTimeout(()=>{throw new Error('worker crashed')},500);");
    const crashState: { signal?: AbortSignal } = {};
    await assert.rejects(runPipeline(crashedWorker, path, 'analogous', 'light', undefined, 'automatic', 'balanced', async (_bytes, signal) => {
        crashState.signal = signal;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    }), /worker crashed/);
    assert.ok(crashState.signal?.aborted);
});
