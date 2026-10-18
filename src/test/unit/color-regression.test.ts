import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseHexColorCode } from '../../color/code';
import { extractRepresentativeColors } from '../../color/extraction';
import { harmonies, syntaxStyles, SyntaxStyle } from '../../model';
import { generateVariant } from '../../variants';

// Per-style fingerprints cover full variants, including workbench/token colors and
// palette metadata. Mellow preserves the former Balanced outputs; both Vibrant styles
// preserve their prior outputs. Balanced has intentional new wallpaper-derived baselines.
// Ignore only the style label (renamed above), and round reported ratios to 10 decimal
// places to tolerate Node/V8 floating-point differences. All color strings remain exact.
const themeBaselines: { colors: string[]; fingerprints: Record<SyntaxStyle, string> }[] = [
    {
        "colors": [
            "#229944",
            "#2244bb",
            "#ddcc22",
            "#cc3344"
        ],
        "fingerprints": {
            "mellow": "a6ef3eea6cc93236c82022f981c7acf9517461b9f58d6a98fc7d2ce1cd04a717",
            "balanced": "6062276dc922de604b39680a379ca3450a56d7c6205f8cb18610b34204d6da74",
            "vibrant": "6abfa3826602ee63aa48dd044f46f6197d685eab2fa4b108e128be9f3aed7688",
            "vibrant-alt": "467edc122a106cb44a6a40de8187089749f0cba172f6affda4a634a12721a927"
        }
    },
    {
        "colors": [
            "#697663",
            "#bac0b8",
            "#3a572e"
        ],
        "fingerprints": {
            "mellow": "5cdd605d1566f3366585cf75678e2d920890b90fcf4959539da72955a0477c68",
            "balanced": "63f77733cb2d26292d073fcd3c72706244ba9591f5efb915b06fa692081edcae",
            "vibrant": "4822b59b0b4857a2822d5faebab9c4a70987266a4ef88d991e168470656f81fd",
            "vibrant-alt": "32e1d5cdef4d397cb9f20b31d3f5590ee9ec476e35a79ede9ae0c72b96b91ffe"
        }
    },
    {
        "colors": [
            "#111111",
            "#777777",
            "#eeeeee"
        ],
        "fingerprints": {
            "mellow": "6da156a2d2919c17eea76c4a0d7e1a6b2846183306290d4e232e08df3fbefc96",
            "balanced": "65237a045a0f923740f63d6a6b762e72d4dab3437b22f7d3687424013d2c66e7",
            "vibrant": "f9e6e63adba373dd3998811ec75a323b135cfadab31a4428b104bb0c73574863",
            "vibrant-alt": "f9e6e63adba373dd3998811ec75a323b135cfadab31a4428b104bb0c73574863"
        }
    },
    {
        "colors": [
            "#ef1234",
            "#34abce",
            "#ffa200"
        ],
        "fingerprints": {
            "mellow": "e43a9b8b8f804046b2d882c25566980b717c378119ea434673fdcf0386c82745",
            "balanced": "945713cd0ab740ca8797115ffed6f897d91bccaddd3853ac88b326666b756885",
            "vibrant": "e38f15d22fdb71aed4fe1cfc8a0a75862d75455e834a4cf18ef649695e19088c",
            "vibrant-alt": "488e5849367ebded40a2028cd5c36e9ab9ffa81dcd8989b7efda4ab409c57eea"
        }
    }
];

test('768 theme variants preserve their per-style visual baselines', () => {
    for (const baseline of themeBaselines) {
        const swatches = baseline.colors.map((hex, index) => ({ hex: parseHexColorCode(hex), weight: index === 0 ? 0.7 : 0.3 / (baseline.colors.length - 1) }));
        for (const syntaxStyle of syntaxStyles) {
            const variants = [];
            for (const harmony of harmonies) {
                for (const appearance of ['dark', 'light'] as const) {
                    for (const primary of ['automatic', 'wallpaper-2', 'harmony-5', 'wallpaper-8'] as const) {
                        const variant = generateVariant(swatches, harmony, appearance, primary, syntaxStyle, 'vibrant', 'colorful');
                        assert.equal(variant.syntaxStyle, syntaxStyle);
                        variants.push(variant);
                    }
                }
            }
            const serialized = JSON.stringify(variants, (key, value: unknown) =>
                key === 'syntaxStyle' ? undefined : key === 'ratio' && typeof value === 'number' ? Number(value.toFixed(10)) : value);
            const fingerprint = createHash('sha256').update(serialized).digest('hex');
            assert.equal(fingerprint, baseline.fingerprints[syntaxStyle], `Output changed for ${syntaxStyle}: ${baseline.colors.join(', ')}`);
        }
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
// vibrant syntax retains the source palette. The per-style baselines above cover colorful tint.
test('subtle light tint with explicit vibrant borders retains blue, green and grayscale visual baselines', () => {
    for (const [hex, expected] of [
        ['#0088ff', '4ed21034be71c57feabdd365c9422c306a243bce88f30f7e0d3356c404be86e7'],
        ['#00cc66', 'ffa4faa4b1fdd6288d7a3682fdc42976e60cc0af8e49b7ae9527d6917d7e1dd3'],
        ['#888888', 'd16ea103c9dc08686e04a3622e369a251a435edd7e18d554f4a9db5b8ce3cf8a'],
    ]) {
        const result = generateVariant([{ hex: parseHexColorCode(hex), weight: 1 }], 'analogous', 'light', 'automatic', 'vibrant', 'vibrant');
        const serialized = JSON.stringify(result, (key, value: unknown) => key === 'ratio' && typeof value === 'number' ? Number(value.toFixed(10)) : value);
        assert.equal(createHash('sha256').update(serialized).digest('hex'), expected, `Subtle light output changed for ${hex}`);
    }
});
