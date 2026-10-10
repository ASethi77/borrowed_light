import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, extract, harmonize, lch, matrix, readable } from '../../colors';
import { Appearance, harmonies } from '../../model';
import { generateTheme } from '../../theme';

const swatches = [{ hex: '#248abb', weight: 0.7 }, { hex: '#dc7b4d', weight: 0.3 }];
test('WCAG reference ratios, symmetry, and diagonal', () => {
    assert.equal(contrast('#000000', '#ffffff'), 21);
    assert.equal(contrast('#ffffff', '#ffffff'), 1);
    assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.478) < 0.001);
    const pairs = matrix(['#000000', '#ffffff', '#248abb']);
    for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { assert.equal(pairs[i][j], pairs[j][i]); } }
});
test('extraction is deterministic, opacity-weighted, and merges equal swatches', () => {
    const pixels = Uint8Array.from([255,0,0,255, 0,0,255,128, 0,255,0,0]);
    const result = extract(pixels, 3, 1);
    assert.deepEqual(result, extract(pixels, 3, 1));
    assert.equal(result.length, 2);
    assert.equal(result[0].hex, '#ff0000');
    assert.ok(Math.abs(result[0].weight - 255 / 383) < 1e-10);
    assert.deepEqual(extract(Uint8Array.from([55,55,55,255]), 1, 1), [{hex:'#373737',weight:1}]);
    assert.throws(() => extract(Uint8Array.from([0,0,0,0]), 1, 1), /visible pixels/);
});
test('median cut handles a large multicolor histogram with normalized weights', () => {
    const data = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < 65536; i++) { data.set([i % 256, Math.floor(i / 256), i % 117, 255], i * 4); }
    const result = extract(data, 256, 256);
    assert.equal(result.length, 8);
    assert.ok(Math.abs(result.reduce((sum, value) => sum + value.weight, 0) - 1) < 1e-9);
});
test('every harmony produces five deterministic, in-gamut colors; neutrals stay neutral', () => {
    for (const harmony of harmonies) {
        const result = harmonize(swatches, harmony);
        assert.equal(result.palette.length, 5);
        assert.deepEqual(result, harmonize(swatches, harmony));
        result.palette.forEach(hex => assert.match(hex, /^#[0-9a-f]{6}$/));
        const gray = harmonize([{ hex: '#999999', weight: 1 }], harmony);
        assert.equal(gray.neutral, true);
        gray.palette.forEach(hex => assert.ok(lch(hex).c < 0.001));
    }
    const shades = harmonize(swatches, 'shades').palette.map(hex => lch(hex).l);
    assert.ok(shades.every((value, i) => !i || value <= shades[i - 1] + 0.002));
});
test('all harmony/appearance combinations meet assigned role contrast and actual token pairs', () => {
    for (const harmony of harmonies) {
        for (const appearance of ['dark', 'light'] as Appearance[]) {
            const theme = generateTheme(harmonize(swatches, harmony).palette, appearance);
            theme.checks.forEach(check => assert.ok(check.ratio >= check.minimum, `${harmony}/${appearance}: ${check.role}: ${check.ratio}`));
            for (const foreground of [...theme.textMateRules.map(rule => rule.settings.foreground), ...Object.values(theme.semanticRules)]) {
                for (const background of ['editor.background', 'editor.selectionBackground', 'editor.findMatchBackground']) {
                    assert.ok(contrast(foreground, theme.colors[background]) >= 4.5);
                }
            }
            for (const [foreground, backgrounds] of [
                ['button.foreground', ['button.background', 'button.hoverBackground']],
                ['button.secondaryForeground', ['button.secondaryBackground', 'button.secondaryHoverBackground']],
                ['input.foreground', ['input.background']],
                ['input.placeholderForeground', ['input.background']],
                ['list.activeSelectionForeground', ['list.activeSelectionBackground']],
                ['editorSuggestWidget.selectedForeground', ['editorSuggestWidget.selectedBackground']],
                ['statusBar.foreground', ['statusBar.background']],
            ] as [string, string[]][]) {
                for (const background of backgrounds) { assert.ok(contrast(theme.colors[foreground], theme.colors[background]) >= 4.5, `${foreground}/${background}`); }
            }
        }
    }
});
test('contrast uses quantized sRGB and fails impossible multi-surface assignments', () => {
    const adjusted = readable('#777777', ['#ffffff'], 4.5);
    assert.ok(contrast(adjusted, '#ffffff') >= 4.5);
    assert.throws(() => readable('#777777', ['#000000', '#ffffff'], 7), /Cannot meet/);
});
