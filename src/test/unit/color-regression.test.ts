import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseHexColorCode } from '../../color/code';
import { extractRepresentativeColors } from '../../color/extraction';
import { harmonies, syntaxStyles } from '../../model';
import { generateVariant } from '../../variants';

// Captured from the implementation before the readability/type refactor. Fingerprints
// include full palettes, workbench/token colors, role order and contrast ratios.
// Normalize ONLY reported ratios to 10 decimal places: Node/V8 versions differ in the
// last floating-point bits of sRGB exponentiation. Color strings and every other field
// remain exact; production calculations and contrast threshold checks are unchanged.
// Update only for an intentional visual/algorithm change, not a structural refactor.
const themeBaselines = [
    { colors: ['#229944', '#2244bb', '#ddcc22', '#cc3344'], fingerprint: '332fa282d0b6de76c2bf043c48d1ee12152752d104b772f71aa889142e32bafd' },
    { colors: ['#697663', '#bac0b8', '#3a572e'], fingerprint: '0d260d90deebe16b6dc7dd07ae2285b612911b6b57b0f76ee4ebc9eabbf4b63b' },
    { colors: ['#111111', '#777777', '#eeeeee'], fingerprint: 'a326d395bf0bdaa950dc3fb150ea76f92e6b996eff6bdb62de55c9d1b1ae311a' },
    { colors: ['#ef1234', '#34abce', '#ffa200'], fingerprint: '5c96b5807531de96f97d4c697ac9c523911cfbd9a7ce110a0b118d46ab79c72b' },
];

test('768 vibrant-border variants retain their complete pre-refactor outputs', () => {
    for (const baseline of themeBaselines) {
        const swatches = baseline.colors.map((hex, index) => ({ hex: parseHexColorCode(hex), weight: index === 0 ? 0.7 : 0.3 / (baseline.colors.length - 1) }));
        const variants = [];
        for (const harmony of harmonies) {
            for (const appearance of ['dark', 'light'] as const) {
                for (const syntaxStyle of syntaxStyles) {
                    for (const primary of ['automatic', 'wallpaper-2', 'harmony-5', 'wallpaper-8'] as const) {
                        variants.push(generateVariant(swatches, harmony, appearance, primary, syntaxStyle, 'vibrant', 'colorful'));
                    }
                }
            }
        }
        const serialized = JSON.stringify(variants, (key, value: unknown) =>
            (key === 'borderContrast' || key === 'backgroundTint') ? undefined : key === 'ratio' && typeof value === 'number' ? Number(value.toFixed(10)) : value);
        const fingerprint = createHash('sha256').update(serialized).digest('hex');
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

// Intentional new light-surface policy: colorful blue/green sources stay quiet while
// vibrant syntax retains the source palette. The existing 768 baselines cover legacy tint.
test('subtle light defaults retain blue, green and grayscale visual baselines', () => {
    for (const [hex, expected] of [
        ['#0088ff', '4ed21034be71c57feabdd365c9422c306a243bce88f30f7e0d3356c404be86e7'],
        ['#00cc66', 'ffa4faa4b1fdd6288d7a3682fdc42976e60cc0af8e49b7ae9527d6917d7e1dd3'],
        ['#888888', 'd16ea103c9dc08686e04a3622e369a251a435edd7e18d554f4a9db5b8ce3cf8a'],
    ]) {
        const result = generateVariant([{ hex: parseHexColorCode(hex), weight: 1 }], 'analogous', 'light', 'automatic', 'vibrant');
        const serialized = JSON.stringify(result, (key, value: unknown) => key === 'ratio' && typeof value === 'number' ? Number(value.toFixed(10)) : value);
        assert.equal(createHash('sha256').update(serialized).digest('hex'), expected, `Subtle light output changed for ${hex}`);
    }
});
