import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { parsePs } = require('../../../tools/image-sampler.cjs');
const { expectedOutcome, writeReport, measure } = require('../../../tools/profile-images.cjs');

test('resource collectors select descendants and preserve distinct process measurements', () => {
    const rows = parsePs('10 1 100 00:01.25\n11 10 200 01:02.50\n12 11 300 1-02:03:04\n13 1 999 00:00.00', 10);
    assert.deepEqual(rows.map((row: { pid: number }) => row.pid), [10,11,12]);
    assert.equal(rows[0].rss, 102400); assert.equal(rows[0].highWater, null);
    assert.equal(rows[0].cpuMs, 1250); assert.equal(rows[1].cpuMs, 62500);
    assert.equal(rows[2].cpuMs, (86400 + 2*3600 + 3*60 + 4) * 1000);
});

test('profiling gates correctness, distinguishes expected rejection, and escapes report content', async () => {
    assert.equal(expectedOutcome(undefined, false), 'passed');
    assert.equal(expectedOutcome('exceeds the 256 megapixel limit', true), 'expected-rejection');
    assert.equal(expectedOutcome('decoder crashed', true), 'failed');
    assert.equal(expectedOutcome(undefined, true), 'failed');
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-report-'));
    try {
        writeReport(directory, { schemaVersion: 1, created: 'test', environment: { platform:'test', arch:'test', commit:'test' }, rows:[{ id:'<script>"bad"', decoder:'portable', run:1, jobs:1, limit:256, outcome:'failed', durationMs:1, error:'<img src=x>', resources:{sampledTreePeakBytes:1024} }] });
        const html = await readFile(join(directory,'report.html'),'utf8');
        assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<img src=x>'));
        assert.equal(JSON.parse(await readFile(join(directory,'report.json'),'utf8')).rows[0].outcome, 'failed');
    } finally { await rm(directory,{recursive:true,force:true}); }
});

test('fast admission errors still collect a process sample and redact literal input paths', async () => {
    const path = resolve('missing-profile-input.png');
    const result = await measure({path}, 'portable', 256, 1);
    assert.ok(result.error.includes('ENOENT'));
    assert.ok(!result.error.includes(path));
    assert.ok(result.resources.samples > 0);
    assert.ok(result.resources.sampledTreePeakBytes > 0);
    assert.equal(result.resources.error, null);
});
