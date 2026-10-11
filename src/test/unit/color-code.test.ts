import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHexColorCode, parseHexColorCode } from '../../color/code';
import { fromOklch, toOklch } from '../../color/conversion';

test('opaque hex factory and guard preserve valid spelling and reject unsupported formats', () => {
    for (const value of ['#000000', '#ffffff', '#Ab12CD']) {
        assert.ok(isHexColorCode(value));
        assert.equal(parseHexColorCode(value), value);
    }
    for (const value of ['#abc', '#abcd', '#12345678', 'red', '123456', '#gg0000', '#12345', '#1234567', ' #123456', '#123456\n', undefined, null, 123456]) {
        assert.equal(isHexColorCode(value), false, String(value));
        assert.throws(() => parseHexColorCode(value), /Invalid opaque hex color/);
    }
});
test('conversion adapter uses named coordinates and returns validated in-gamut hex', () => {
    const source = parseHexColorCode('#2244bb');
    const coordinates = toOklch(source);
    assert.equal(fromOklch(coordinates), source);
    assert.ok(coordinates.lightness > 0 && coordinates.lightness < 1);
    assert.ok(coordinates.chroma > 0);
    assert.ok(isHexColorCode(fromOklch({ lightness: 0.6, chroma: 0.8, hueDegrees: -90 })));
    assert.equal(fromOklch({ lightness: 0.6, chroma: 0.8, hueDegrees: -90 }), fromOklch({ lightness: 0.6, chroma: 0.8, hueDegrees: 270 }));
});
