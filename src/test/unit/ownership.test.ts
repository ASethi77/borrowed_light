import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOwned, restoreOwned } from '../../ownership';

test('theme writes preserve unrelated blocks and restore the original baseline across repeated sync/restart', () => {
    const original = { '[Other]': { foo: 'keep' }, '[Borrowed Light (Dark)]': { a: 'original', unrelated: 'keep' } };
    const first = mergeOwned(original, '[Borrowed Light (Dark)]', { a: 'generated', b: 'new' });
    const restarted = JSON.parse(JSON.stringify(first.ledger));
    const second = mergeOwned(first.value, '[Borrowed Light (Dark)]', { a: 'updated', b: 'updated' }, restarted);
    assert.deepEqual(second.value['[Other]'], original['[Other]']);
    assert.deepEqual(restoreOwned(second.value, '[Borrowed Light (Dark)]', second.ledger), original);
});
test('restore retains subsequent user edits and can remove only generated blocks', () => {
    const first = mergeOwned(undefined, '[Borrowed Light (Dark)]', { a: 'generated', b: 'generated' });
    const edited = { ...first.value, '[Borrowed Light (Dark)]': { a: 'user edit', b: 'generated', custom: 'keep' }, elsewhere: 'keep' };
    assert.deepEqual(restoreOwned(edited, '[Borrowed Light (Dark)]', first.ledger), { '[Borrowed Light (Dark)]': { a: 'user edit', custom: 'keep' }, elsewhere: 'keep' });
    assert.deepEqual(restoreOwned(first.value, '[Borrowed Light (Dark)]', first.ledger), {});
    assert.equal(restoreOwned(undefined, '[Borrowed Light (Dark)]', first.ledger), undefined);
    const empty = mergeOwned({ '[Borrowed Light (Dark)]': {} }, '[Borrowed Light (Dark)]', { a: 'generated' });
    assert.deepEqual(restoreOwned(empty.value, '[Borrowed Light (Dark)]', empty.ledger), { '[Borrowed Light (Dark)]': {} });
});
