import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseHexColorCode } from '../../color/code';
import { extractRepresentativeColors } from '../../color/extraction';
import { harmonies, syntaxStyles } from '../../model';
import { generateVariant } from '../../variants';

// Captured from the implementation before the readability/type refactor. Fingerprints
// include full palettes, workbench/token colors, role order and unrounded contrast ratios.
// Update only for an intentional visual/algorithm change, not a structural refactor.
const themeBaselines = [
    { colors: ['#229944', '#2244bb', '#ddcc22', '#cc3344'], fingerprint: 'f31f5757a83ec45ad0a1caa269a5be0d016d49867566799de92aca0bfe968532' },
    { colors: ['#697663', '#bac0b8', '#3a572e'], fingerprint: '504a6faba21cc0f801adb35f4d8ee97dcf2fc28625eb3ed975df1923acd15215' },
    { colors: ['#111111', '#777777', '#eeeeee'], fingerprint: '07ecee2505ac8b5fcae6b42311c6a0c817aa7f3e7fb7b491e5a980581a89d36e' },
    { colors: ['#ef1234', '#34abce', '#ffa200'], fingerprint: '15e52ea2e19c251b35310e09957a0328f1b0ef8b9b66e8704f3644e954f8bc69' },
];

test('768 generated variants retain their complete pre-refactor outputs', () => {
    for (const baseline of themeBaselines) {
        const swatches = baseline.colors.map((hex, index) => ({ hex: parseHexColorCode(hex), weight: index === 0 ? 0.7 : 0.3 / (baseline.colors.length - 1) }));
        const variants = [];
        for (const harmony of harmonies) {
            for (const appearance of ['dark', 'light'] as const) {
                for (const syntaxStyle of syntaxStyles) {
                    for (const primary of ['automatic', 'wallpaper-2', 'harmony-5', 'wallpaper-8'] as const) {
                        variants.push(generateVariant(swatches, harmony, appearance, primary, syntaxStyle));
                    }
                }
            }
        }
        const fingerprint = createHash('sha256').update(JSON.stringify(variants)).digest('hex');
        assert.equal(fingerprint, baseline.fingerprint, `Output changed for ${baseline.colors.join(', ')}`);
    }
});

test('extraction retains opacity, centroid and sampled-grid baselines', () => {
    const images = [
        { width: 4, height: 1, data: Uint8Array.from([255,0,0,255, 0,255,0,128, 0,0,255,0, 127,127,127,255]) },
        { width: 1, height: 1, data: Uint8Array.from([55,55,55,255]) },
        { width: 300, height: 300, data: Uint8Array.from({ length: 300 * 300 * 4 }, (_, index) => index % 4 === 3 ? 128 : (index * 73) % 256) },
    ];
    const expected = [[{"hex": "#7f7f7f", "weight": 0.3996865203761755}, {"hex": "#ff0000", "weight": 0.3996865203761755}, {"hex": "#00ff00", "weight": 0.2006269592476489}], [{"hex": "#373737", "weight": 1}], [{"hex": "#d41d66", "weight": 0.24999999999999997}, {"hex": "#5099e2", "weight": 0.21919999999999998}, {"hex": "#246db6", "weight": 0.12497777777777776}, {"hex": "#a4ed36", "weight": 0.12497777777777776}, {"hex": "#4d9636", "weight": 0.09333333333333332}, {"hex": "#bb864d", "weight": 0.06253333333333333}, {"hex": "#0c559e", "weight": 0.06248888888888888}, {"hex": "#8cd51e", "weight": 0.06248888888888888}]];
    assert.deepEqual(images.map(image => extractRepresentativeColors(image.data, image.width, image.height)), expected);
});
