import { harmonize } from './colors';
import { Appearance, harmonies, Harmony, PaletteResult, PreviewVariants, PrimaryChoice, PrimaryChoices, Swatch, SyntaxStyle } from './model';
import { resolvePrimary } from './primary';
import { generateTheme } from './theme';

export function generateVariant(swatches: Swatch[], harmony: Harmony, appearance: Appearance, choice: PrimaryChoice = 'automatic', syntaxStyle: SyntaxStyle = 'balanced'): PaletteResult {
    const { palette, neutral } = harmonize(swatches, harmony);
    const primary = resolvePrimary(swatches, palette, choice);
    return { swatches, palette, neutral, primary, syntaxStyle, theme: generateTheme(palette, appearance, undefined, swatches, primary.hex, syntaxStyle) };
}
export function generateVariants(swatches: Swatch[], primaries: PrimaryChoices = { dark: 'automatic', light: 'automatic' }, syntaxStyle: SyntaxStyle = 'balanced'): PreviewVariants {
    return Object.fromEntries(harmonies.map(harmony => [harmony, {
        dark: generateVariant(swatches, harmony, 'dark', primaries.dark, syntaxStyle),
        light: generateVariant(swatches, harmony, 'light', primaries.light, syntaxStyle),
    }])) as PreviewVariants;
}
