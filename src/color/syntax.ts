import { HexColorCode } from './code';
import { fromOklch, fullHueTurnDegrees, toOklch } from './conversion';
import { minimumChromaticChroma } from './harmony';
import { Appearance, Swatch, SyntaxStyle } from '../model';

// Custom palette policy: separation angles and saturation bounds are visual design choices.
const syntaxPolicy = {
    familyCount: 6, observedSeparationDegrees: 25, vibrantSeparationDegrees: 40,
    derivedLightness: 0.65, derivedChroma: 0.16,
    mellow: { scale: 0.3, maximumChroma: 0.045 },
    balanced: { scale: 0.7, maximumChroma: 0.11 },
    vibrant: { scale: 1.35, minimumChroma: 0.14, maximumChroma: 0.24 },
    baseLightness: { dark: 0.73, light: 0.43 },
};
const halfHueTurnDegrees = fullHueTurnDegrees / 2;
/** Shortest distance on a circular hue wheel, in [0,180] degrees. */
function hueDistance(hueDegreesA: number, hueDegreesB: number): number {
    return Math.abs((hueDegreesA - hueDegreesB + (fullHueTurnDegrees + halfHueTurnDegrees)) % fullHueTurnDegrees - halfHueTurnDegrees);
}

/** Greedily prefer the hue farthest from all selected hues. Weight then hex spelling
 * break ties, so small wallpaper highlights can survive a dominant background.
 */
export function syntaxSources(swatches: Swatch[], fallback: HexColorCode[]): HexColorCode[] {
    const candidates = swatches.filter(swatch => toOklch(swatch.hex).chroma >= minimumChromaticChroma);
    if (!candidates.length) { return swatches.length ? [swatches[0].hex] : fallback; }
    const selected = [candidates[0].hex];
    while (selected.length < syntaxPolicy.familyCount) {
        const remaining = candidates.filter(swatch => !selected.includes(swatch.hex)).map(swatch => ({
            ...swatch, distance: Math.min(...selected.map(colorCode => hueDistance(toOklch(colorCode).hueDegrees, toOklch(swatch.hex).hueDegrees))),
        })).sort((first, second) => second.distance - first.distance || second.weight - first.weight || first.hex.localeCompare(second.hex));
        if (!remaining.length || remaining[0].distance < syntaxPolicy.observedSeparationDegrees) { break; }
        selected.push(remaining[0].hex);
    }
    return selected;
}

/** Keep observed and harmony hues first; derive missing accents by bisecting the
 * largest hue-wheel gaps. These extra accents are not extracted wallpaper colors.
 */
export function vibrantSources(swatches: Swatch[], palette: HexColorCode[]): HexColorCode[] {
    const candidates = [...syntaxSources(swatches, palette), ...palette].filter(colorCode => toOklch(colorCode).chroma >= minimumChromaticChroma);
    if (!candidates.length) { return syntaxSources(swatches, palette); }
    const selected = [candidates[0]];
    // Greedy farthest-point selection, with hex spelling breaking equal hue distances.
    while (selected.length < syntaxPolicy.familyCount) {
        const remaining = candidates.filter(colorCode => !selected.includes(colorCode)).map(hex => ({
            hex, distance: Math.min(...selected.map(chosen => hueDistance(toOklch(hex).hueDegrees, toOklch(chosen).hueDegrees))),
        })).sort((first, second) => second.distance - first.distance || first.hex.localeCompare(second.hex));
        if (!remaining.length || remaining[0].distance < syntaxPolicy.vibrantSeparationDegrees) { break; }
        selected.push(remaining[0].hex);
    }
    // Include the wraparound gap from the final hue back to the first. Equal largest
    // gaps prefer the lowest starting hue. Gamut-map each midpoint before the next pass.
    while (selected.length < syntaxPolicy.familyCount) {
        const hues = selected.map(colorCode => toOklch(colorCode).hueDegrees).sort((first, second) => first - second);
        const gaps = hues.map((hue, index) => ({ hue, size: (hues[(index + 1) % hues.length] + (index === hues.length - 1 ? fullHueTurnDegrees : 0)) - hue }));
        gaps.sort((first, second) => second.size - first.size || first.hue - second.hue);
        selected.push(fromOklch({ lightness: syntaxPolicy.derivedLightness, chroma: syntaxPolicy.derivedChroma, hueDegrees: gaps[0].hue + gaps[0].size / 2 }));
    }
    return selected;
}

const familyLightnessOffsets = { keywords: 0.02, strings: -0.02, constants: 0.04, functions: 0, types: -0.01, identifiers: 0.01 };
export type SyntaxFamilyColors = Record<keyof typeof familyLightnessOffsets, HexColorCode>;

/** Assign semantic families in stable order. Mellow/balanced reuse the harmony;
 * vibrant expands its hue coverage, and alternate rotates assignments by one slot.
 * Saturation is adjusted here; final surface contrast is enforced by theme generation.
 */
export function syntaxColors(swatches: Swatch[], fallback: HexColorCode[], appearance: Appearance, style: SyntaxStyle): SyntaxFamilyColors {
    const sources = style === 'mellow' || style === 'balanced' ? fallback : vibrantSources(swatches, fallback);
    const sourceRotation = style === 'vibrant-alt' ? 1 : 0;
    const vivid = style === 'vibrant' || style === 'vibrant-alt';
    return Object.fromEntries(Object.entries(familyLightnessOffsets).map(([family, lightnessOffset], index) => {
        const source = toOklch(sources[(index + sourceRotation) % sources.length]);
        const chroma = style === 'mellow' ? Math.min(source.chroma * syntaxPolicy.mellow.scale, syntaxPolicy.mellow.maximumChroma)
            : vivid ? (source.chroma < minimumChromaticChroma ? 0 : Math.min(Math.max(source.chroma * syntaxPolicy.vibrant.scale, syntaxPolicy.vibrant.minimumChroma), syntaxPolicy.vibrant.maximumChroma))
                : Math.min(source.chroma * syntaxPolicy.balanced.scale, syntaxPolicy.balanced.maximumChroma);
        const lightness = syntaxPolicy.baseLightness[appearance] + lightnessOffset;
        return [family, fromOklch({ lightness, chroma, hueDegrees: source.hueDegrees })];
    })) as SyntaxFamilyColors;
}
