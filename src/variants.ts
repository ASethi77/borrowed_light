import { harmonize } from './colors';
import { Appearance, harmonies, Harmony, PaletteResult, PreviewVariants, PrimaryChoice, PrimaryChoices, Swatch } from './model';
import { resolvePrimary } from './primary';
import { generateTheme } from './theme';

export function generateVariant(swatches: Swatch[], harmony: Harmony, appearance: Appearance, choice: PrimaryChoice = 'automatic'): PaletteResult {
    const { palette, neutral } = harmonize(swatches, harmony);
    const primary = resolvePrimary(swatches, palette, choice);
    return { swatches, palette, neutral, primary, theme: generateTheme(palette, appearance, undefined, swatches, primary.hex) };
}
export function generateVariants(swatches: Swatch[], primaries: PrimaryChoices = { dark: 'automatic', light: 'automatic' }): PreviewVariants {
    return Object.fromEntries(harmonies.map(harmony => [harmony, {
        dark: generateVariant(swatches, harmony, 'dark', primaries.dark),
        light: generateVariant(swatches, harmony, 'light', primaries.light),
    }])) as PreviewVariants;
}
