import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import * as jpeg from 'jpeg-js';
import { decodeImage } from '../../palette-worker';
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
    await assert.rejects(runPipeline(resolve('dist/palette-worker.js'), '/tmp/unused', 'analogous', 'dark', abort.signal), Cancelled);
    const active = new AbortController();
    const pending = runPipeline(resolve('dist/palette-worker.js'), '/tmp/unused', 'analogous', 'dark', active.signal);
    active.abort();
    await assert.rejects(pending, Cancelled);
});
test('worker errors and deadlines reject and terminate processing', async context => {
    await assert.rejects(runPipeline(resolve('dist/nonexistent-worker.js'), '/tmp/unused', 'analogous', 'dark'), /Cannot find module/);
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = runPipeline(resolve('dist/palette-worker.js'), '/tmp/unused', 'analogous', 'dark');
    context.mock.timers.tick(15000);
    await assert.rejects(pending, /exceeded 15 seconds/);
    context.mock.timers.reset();
});
