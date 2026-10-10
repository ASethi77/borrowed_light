import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOwned, restoreOwned } from '../../ownership';

test('theme writes preserve unrelated blocks and restore the original baseline across repeated sync/restart', () => {
    const original = { '[Other]': { foo: 'keep' }, '[Wallpaper Paste Dark]': { a: 'original', unrelated: 'keep' } };
    const first = mergeOwned(original, '[Wallpaper Paste Dark]', { a: 'generated', b: 'new' });
    const restarted = JSON.parse(JSON.stringify(first.ledger));
    const second = mergeOwned(first.value, '[Wallpaper Paste Dark]', { a: 'updated', b: 'updated' }, restarted);
    assert.deepEqual(second.value['[Other]'], original['[Other]']);
    assert.deepEqual(restoreOwned(second.value, '[Wallpaper Paste Dark]', second.ledger), original);
});
test('restore retains subsequent user edits and can remove only generated blocks', () => {
    const first = mergeOwned(undefined, '[Wallpaper Paste Dark]', { a: 'generated', b: 'generated' });
    const edited = { ...first.value, '[Wallpaper Paste Dark]': { a: 'user edit', b: 'generated', custom: 'keep' }, elsewhere: 'keep' };
    assert.deepEqual(restoreOwned(edited, '[Wallpaper Paste Dark]', first.ledger), { '[Wallpaper Paste Dark]': { a: 'user edit', custom: 'keep' }, elsewhere: 'keep' });
    assert.deepEqual(restoreOwned(first.value, '[Wallpaper Paste Dark]', first.ledger), {});
    assert.equal(restoreOwned(undefined, '[Wallpaper Paste Dark]', first.ledger), undefined);
    const empty = mergeOwned({ '[Wallpaper Paste Dark]': {} }, '[Wallpaper Paste Dark]', { a: 'generated' });
    assert.deepEqual(restoreOwned(empty.value, '[Wallpaper Paste Dark]', empty.ledger), { '[Wallpaper Paste Dark]': {} });
});
