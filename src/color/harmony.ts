import { HexColorCode } from './code';
import { fromOklch, toOklch } from './conversion';
import { Harmony, Swatch } from '../model';

// Custom seed eligibility and saturation limits; these are not color-theory standards.
export const minimumChromaticChroma = 0.025;
const seedPolicy = { minimumWeight: 0.01, maximumChroma: 0.18 };
interface HarmonyStop { lightness: number; chromaScale: number; hueOffsetDegrees: number }
// Hue relationships follow familiar wheel recipes. Lightness/chroma choices are our
// design policy, applied in OKLCH rather than a traditional artist's RYB wheel.
// Overview: https://en.wikipedia.org/wiki/Color_scheme
const harmonyRecipes = {
    analogous: [-60, -30, 0, 30, 60].map(hueOffsetDegrees => ({ lightness: 0.65, chromaScale: 1, hueOffsetDegrees })),
    triad: [
        { lightness: 0.55, chromaScale: 1, hueOffsetDegrees: 0 },
        { lightness: 0.65, chromaScale: 1, hueOffsetDegrees: 120 },
        { lightness: 0.65, chromaScale: 1, hueOffsetDegrees: 240 },
        { lightness: 0.75, chromaScale: 0.65, hueOffsetDegrees: 0 },
        { lightness: 0.75, chromaScale: 0.65, hueOffsetDegrees: 120 },
    ],
    complementary: [
        { lightness: 0.55, chromaScale: 1, hueOffsetDegrees: 0 },
        { lightness: 0.7, chromaScale: 1, hueOffsetDegrees: 0 },
        { lightness: 0.65, chromaScale: 1, hueOffsetDegrees: 180 },
        { lightness: 0.75, chromaScale: 0.65, hueOffsetDegrees: 180 },
        { lightness: 0.8, chromaScale: 0.4, hueOffsetDegrees: 0 },
    ],
    compound: [0, -30, 30, 150, 210].map(hueOffsetDegrees => ({ lightness: 0.65, chromaScale: 1, hueOffsetDegrees })),
    monochromatic: [
        { lightness: 0.35, chromaScale: 0.3, hueOffsetDegrees: 0 },
        { lightness: 0.45, chromaScale: 0.6, hueOffsetDegrees: 0 },
        { lightness: 0.55, chromaScale: 0.85, hueOffsetDegrees: 0 },
        { lightness: 0.65, chromaScale: 1, hueOffsetDegrees: 0 },
        { lightness: 0.75, chromaScale: 0.5, hueOffsetDegrees: 0 },
    ],
} satisfies Record<Exclude<Harmony, 'shades'>, HarmonyStop[]>;
const shadePolicy = { lightnessDecrements: [0, 0.1, 0.2, 0.3, 0.4], minimumLightness: 0.1 };

/** Choose the first sufficiently chromatic, sufficiently weighted swatch (normally
 * weight-ordered by extraction). If none qualifies, preserve a neutral palette.
 */
export function generateHarmonyPalette(swatches: Swatch[], harmony: Harmony): { palette: HexColorCode[]; neutral: boolean } {
    if (!swatches.length) { throw new Error('No extracted colors'); }
    const eligibleSeed = swatches.find(swatch => toOklch(swatch.hex).chroma >= minimumChromaticChroma && swatch.weight >= seedPolicy.minimumWeight);
    const neutral = !eligibleSeed;
    const seed = toOklch((eligibleSeed ?? swatches[0]).hex);
    const chroma = neutral ? 0 : Math.min(seed.chroma, seedPolicy.maximumChroma);
    const palette = harmony === 'shades'
        ? shadePolicy.lightnessDecrements.map(decrement => fromOklch({ lightness: Math.max(shadePolicy.minimumLightness, seed.lightness - decrement), chroma, hueDegrees: seed.hueDegrees }))
        : harmonyRecipes[harmony].map(stop => fromOklch({ lightness: stop.lightness, chroma: chroma * stop.chromaScale, hueDegrees: seed.hueDegrees + stop.hueOffsetDegrees }));
    return { palette, neutral };
}
