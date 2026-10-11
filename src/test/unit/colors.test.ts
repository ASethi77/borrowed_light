import { parseHexColorCode } from '../../color/code';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, contrastMatrix, ensureReadableColor } from '../../color/contrast';
import { extractRepresentativeColors } from '../../color/extraction';
import { generateHarmonyPalette } from '../../color/harmony';
import { toOklch } from '../../color/conversion';
import { Appearance, harmonies, syntaxStyles } from '../../model';
import { generateTheme } from '../../color/theme';
import { generateVariant } from '../../variants';
import { isPrimaryChoice, primaryColors, resolvePrimary } from '../../primary';
import { syntaxSources } from '../../color/syntax';

const swatches = [{ hex: parseHexColorCode('#248abb'), weight: 0.7 }, { hex: parseHexColorCode('#dc7b4d'), weight: 0.3 }];
test('WCAG reference ratios, symmetry, and diagonal', () => {
    assert.equal(contrastRatio(parseHexColorCode('#000000'), parseHexColorCode('#ffffff')), 21);
    assert.equal(contrastRatio(parseHexColorCode('#ffffff'), parseHexColorCode('#ffffff')), 1);
    assert.ok(Math.abs(contrastRatio(parseHexColorCode('#777777'), parseHexColorCode('#ffffff')) - 4.478) < 0.001);
    const pairs = contrastMatrix([parseHexColorCode('#000000'), parseHexColorCode('#ffffff'), parseHexColorCode('#248abb')]);
    for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { assert.equal(pairs[i][j], pairs[j][i]); } }
});
test('extraction is deterministic, opacity-weighted, and merges equal swatches', () => {
    const pixels = Uint8Array.from([255,0,0,255, 0,0,255,128, 0,255,0,0]);
    const result = extractRepresentativeColors(pixels, 3, 1);
    assert.deepEqual(result, extractRepresentativeColors(pixels, 3, 1));
    assert.equal(result.length, 2);
    assert.equal(result[0].hex, parseHexColorCode('#ff0000'));
    assert.ok(Math.abs(result[0].weight - 255 / 383) < 1e-10);
    assert.deepEqual(extractRepresentativeColors(Uint8Array.from([55,55,55,255]), 1, 1), [{hex:parseHexColorCode('#373737'),weight:1}]);
    assert.throws(() => extractRepresentativeColors(Uint8Array.from([0,0,0,0]), 1, 1), /visible pixels/);
});
test('median cut handles a large multicolor histogram with normalized weights', () => {
    const data = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < 65536; i++) { data.set([i % 256, Math.floor(i / 256), i % 117, 255], i * 4); }
    const result = extractRepresentativeColors(data, 256, 256);
    assert.equal(result.length, 8);
    assert.ok(Math.abs(result.reduce((sum, value) => sum + value.weight, 0) - 1) < 1e-9);
});
test('every harmony produces five deterministic, in-gamut colors; neutrals stay neutral', () => {
    for (const harmony of harmonies) {
        const result = generateHarmonyPalette(swatches, harmony);
        assert.equal(result.palette.length, 5);
        assert.deepEqual(result, generateHarmonyPalette(swatches, harmony));
        result.palette.forEach(hex => assert.match(hex, /^#[0-9a-f]{6}$/));
        const gray = generateHarmonyPalette([{ hex: parseHexColorCode('#999999'), weight: 1 }], harmony);
        assert.equal(gray.neutral, true);
        gray.palette.forEach(hex => assert.ok(toOklch(hex).chroma < 0.001));
    }
    const shades = generateHarmonyPalette(swatches, 'shades').palette.map(hex => toOklch(hex).lightness);
    assert.ok(shades.every((value, i) => !i || value <= shades[i - 1] + 0.002));
});
test('all harmony/appearance combinations meet assigned role contrast and actual token pairs', () => {
    for (const harmony of harmonies) {
        for (const appearance of ['dark', 'light'] as Appearance[]) {
            const theme = generateTheme(generateHarmonyPalette(swatches, harmony).palette, appearance);
            theme.checks.forEach(check => assert.ok(check.ratio >= check.minimum, `${harmony}/${appearance}: ${check.role}: ${check.ratio}`));
            for (const foreground of [...theme.textMateRules.map(rule => rule.settings.foreground), ...Object.values(theme.semanticRules)]) {
                for (const background of ['editor.background', 'editor.selectionBackground', 'editor.findMatchBackground']) {
                    assert.ok(contrastRatio(foreground, theme.colors[background]) >= 4.5);
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
                for (const background of backgrounds) { assert.ok(contrastRatio(theme.colors[foreground], theme.colors[background]) >= 4.5, `${foreground}/${background}`); }
            }
        }
    }
});
test('contrast uses quantized sRGB and fails impossible multi-surface assignments', () => {
    const adjusted = ensureReadableColor(parseHexColorCode('#777777'), [parseHexColorCode('#ffffff')], 4.5);
    assert.ok(contrastRatio(adjusted, parseHexColorCode('#ffffff')) >= 4.5);
    assert.throws(() => ensureReadableColor(parseHexColorCode('#777777'), [parseHexColorCode('#000000'), parseHexColorCode('#ffffff')], 7), /Cannot meet/);
});
test('light surfaces reflect wallpaper hue, brightness, and colorfulness while retaining contrast', () => {
    const sources = [parseHexColorCode('#bb3322'), parseHexColorCode('#2288bb'), parseHexColorCode('#33aa44'), parseHexColorCode('#112233'), parseHexColorCode('#aaccff'), parseHexColorCode('#888888')];
    const themes = sources.map(hex => generateVariant([{ hex, weight: 1 }], 'analogous', 'light').theme);
    assert.equal(new Set(themes.map(theme => theme.colors['editor.background'])).size, sources.length);
    assert.equal(new Set(themes.map(theme => theme.colors['sideBar.background'])).size, sources.length);
    assert.ok(toOklch(themes[3].colors['editor.background']).lightness < toOklch(themes[4].colors['editor.background']).lightness);
    assert.ok(toOklch(themes[5].colors['editor.background']).chroma < 0.001);
    for (const hex of sources) {
        for (const harmony of harmonies) {
            for (const appearance of ['light', 'dark'] as Appearance[]) {
                const theme = generateVariant([{ hex, weight: 1 }], harmony, appearance).theme;
                theme.checks.forEach(check => assert.ok(check.ratio >= check.minimum, `${hex}/${harmony}/${appearance}/${check.role}`));
            }
        }
    }
});
test('primary colors include small wallpaper highlights and rule colors without changing the harmony', () => {
    const wallpaper = [
        { hex: parseHexColorCode('#229944'), weight: 0.7 }, { hex: parseHexColorCode('#2266cc'), weight: 0.15 },
        { hex: parseHexColorCode('#eedd22'), weight: 0.1 }, { hex: parseHexColorCode('#cc3322'), weight: 0.05 },
    ];
    for (const harmony of ['analogous', 'triad'] as const) {
        const palette = generateHarmonyPalette(wallpaper, harmony).palette;
        const choices = primaryColors(wallpaper, palette);
        assert.deepEqual(choices.filter(choice => choice.id.startsWith('wallpaper')).map(choice => choice.hex), wallpaper.map(swatch => swatch.hex));
        for (const appearance of ['light', 'dark'] as Appearance[]) {
            const backgrounds = new Set<string>();
            for (const choice of choices) {
                const result = generateVariant(wallpaper, harmony, appearance, choice.id);
                assert.deepEqual(result.palette, palette);
                assert.equal(result.primary.hex, choice.hex);
                backgrounds.add(result.theme.colors['editor.background']);
                result.theme.checks.forEach(check => assert.ok(check.ratio >= check.minimum, `${appearance}/${choice.id}/${check.role}`));
            }
            assert.ok(backgrounds.size >= 4, `${appearance} offers visibly different primary surfaces`);
        }
        assert.equal(resolvePrimary(wallpaper, palette, 'wallpaper-8').id, 'automatic');
    }
    assert.ok(isPrimaryChoice('harmony-5'));
    assert.ok(!isPrimaryChoice('wallpaper-9'));
    assert.ok(!isPrimaryChoice(parseHexColorCode('#2266cc')));
});
test('vibrant syntax uses separated wallpaper highlights and colors identifiers while mellow stays subdued', () => {
    const wallpaper = [
        { hex: parseHexColorCode('#229944'), weight: 0.5 }, { hex: parseHexColorCode('#33aa55'), weight: 0.15 }, { hex: parseHexColorCode('#44bb66'), weight: 0.1 },
        { hex: parseHexColorCode('#2266cc'), weight: 0.1 }, { hex: parseHexColorCode('#eedd22'), weight: 0.1 }, { hex: parseHexColorCode('#cc3322'), weight: 0.05 },
    ];
    assert.deepEqual(new Set(syntaxSources(wallpaper, [])), new Set([parseHexColorCode('#229944'), parseHexColorCode('#2266cc'), parseHexColorCode('#eedd22'), parseHexColorCode('#cc3322')]));
    for (const appearance of ['light', 'dark'] as Appearance[]) {
        const mellow = generateVariant(wallpaper, 'monochromatic', appearance, 'wallpaper-2', 'mellow').theme;
        const vibrant = generateVariant(wallpaper, 'monochromatic', appearance, 'wallpaper-2', 'vibrant').theme;
        assert.deepEqual(vibrant.colors, mellow.colors, 'syntax changes leave the workbench intact');
        assert.equal(mellow.semanticRules.variable, mellow.colors['editor.foreground']);
        for (const category of ['keyword', 'string', 'number', 'function', 'type', 'variable', 'parameter', 'property']) {
            assert.ok(toOklch(vibrant.semanticRules[category]).chroma > toOklch(mellow.semanticRules[category]).chroma);
        }
        assert.ok(new Set(['keyword', 'string', 'number', 'function'].map(key => Math.round(toOklch(vibrant.semanticRules[key]).hueDegrees / 15))).size >= 4);
        const alternate = generateVariant(wallpaper, 'monochromatic', appearance, 'wallpaper-2', 'vibrant-alt').theme;
        assert.notDeepEqual(alternate.semanticRules, vibrant.semanticRules);
        for (const harmony of harmonies) {
            for (const style of syntaxStyles) {
                const theme = generateVariant(wallpaper, harmony, appearance, 'wallpaper-2', style).theme;
                theme.checks.forEach(check => assert.ok(check.ratio >= check.minimum, `${appearance}/${harmony}/${style}/${check.role}`));
                for (const foreground of [...Object.values(theme.semanticRules), ...theme.textMateRules.map(rule => rule.settings.foreground)]) {
                    for (const background of ['editor.background', 'editor.selectionBackground', 'editor.findMatchBackground']) {
                        assert.ok(contrastRatio(foreground, theme.colors[background]) >= 4.5);
                    }
                }
            }
        }
    }
});
test('vibrant syntax does not invent colorful hues for a grayscale wallpaper', () => {
    for (const appearance of ['light', 'dark'] as Appearance[]) {
        for (const style of syntaxStyles) {
            const theme = generateVariant([{ hex: parseHexColorCode('#999999'), weight: 1 }], 'analogous', appearance, 'automatic', style).theme;
            Object.values(theme.semanticRules).forEach(hex => assert.ok(toOklch(hex).chroma < 0.001));
        }
    }
});
test('a green-only wallpaper still gives six distinguishable vibrant token families after contrast adjustment', () => {
    // Regression for the screenshot: eight similar swatches previously became one syntax hue.
    const wallpaper = [parseHexColorCode('#34402f'), parseHexColorCode('#100d0a'), parseHexColorCode('#4a5033'), parseHexColorCode('#2a2e22'), parseHexColorCode('#505d3f'), parseHexColorCode('#8f931e'), parseHexColorCode('#3d5039'), parseHexColorCode('#91975c')].map(hex => ({ hex, weight: 1 / 8 }));
    const families = ['keyword', 'string', 'number', 'function', 'type', 'variable'];
    for (const appearance of ['light', 'dark'] as Appearance[]) {
        for (const style of ['vibrant', 'vibrant-alt'] as const) {
            const result = generateVariant(wallpaper, 'complementary', appearance, 'harmony-5', style);
            const colors = families.map(family => toOklch(result.theme.semanticRules[family]));
            for (let i = 0; i < colors.length; i++) {
                for (let j = i + 1; j < colors.length; j++) {
                    const a = colors[i], b = colors[j];
                    const distance = Math.hypot(a.lightness - b.lightness, a.chroma * Math.cos(a.hueDegrees * Math.PI / 180) - b.chroma * Math.cos(b.hueDegrees * Math.PI / 180), a.chroma * Math.sin(a.hueDegrees * Math.PI / 180) - b.chroma * Math.sin(b.hueDegrees * Math.PI / 180));
                    assert.ok(distance >= 0.075, `${appearance}/${style}: ${families[i]} and ${families[j]} collapsed (${distance})`);
                }
            }
            result.theme.checks.forEach(check => assert.ok(check.ratio >= check.minimum));
            const scopeColor = (scope: string) => result.theme.textMateRules.find(rule => rule.scope.includes(scope))?.settings.foreground;
            assert.equal(scopeColor('meta.function-call.generic.python'), result.theme.semanticRules.function);
            assert.equal(scopeColor('storage.type.string.python'), result.theme.semanticRules.string);
            assert.equal(scopeColor('storage.type.number.python'), result.theme.semanticRules.number);
            assert.notEqual(scopeColor('storage'), scopeColor('entity.name.function'));
        }
    }
});
