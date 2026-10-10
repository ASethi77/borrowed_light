import { harmonize } from './colors';
import { Appearance, harmonies, Harmony, PaletteResult, PreviewVariants, Swatch } from './model';
import { generateTheme } from './theme';

export function generateVariant(swatches: Swatch[], harmony: Harmony, appearance: Appearance): PaletteResult {
    const { palette, neutral } = harmonize(swatches, harmony);
    return { swatches, palette, neutral, theme: generateTheme(palette, appearance, undefined, swatches) };
}
export function generateVariants(swatches: Swatch[]): PreviewVariants {
    return Object.fromEntries(harmonies.map(harmony => [harmony, {
        dark: generateVariant(swatches, harmony, 'dark'),
        light: generateVariant(swatches, harmony, 'light'),
    }])) as PreviewVariants;
}
