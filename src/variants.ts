import { generateHarmonyPalette } from './color/harmony';
import { Appearance, harmonies, Harmony, PaletteResult, PreviewVariants, PrimaryChoice, PrimaryChoices, Swatch, SyntaxStyle, BorderContrast } from './model';
import { resolvePrimary } from './primary';
import { generateTheme } from './color/theme';

export function generateVariant(swatches: Swatch[], harmony: Harmony, appearance: Appearance, choice: PrimaryChoice = 'automatic', syntaxStyle: SyntaxStyle = 'balanced', borderContrast: BorderContrast = 'vibrant'): PaletteResult {
    const { palette, neutral } = generateHarmonyPalette(swatches, harmony);
    const primary = resolvePrimary(swatches, palette, choice);
    return { swatches, palette, neutral, primary, syntaxStyle, borderContrast, theme: generateTheme(palette, appearance, undefined, swatches, primary.hex, syntaxStyle, borderContrast) };
}
export function generateVariants(swatches: Swatch[], primaries: PrimaryChoices = { dark: 'automatic', light: 'automatic' }, syntaxStyle: SyntaxStyle = 'balanced', borderContrast: BorderContrast = 'vibrant'): PreviewVariants {
    return Object.fromEntries(harmonies.map(harmony => [harmony, {
        dark: generateVariant(swatches, harmony, 'dark', primaries.dark, syntaxStyle, borderContrast),
        light: generateVariant(swatches, harmony, 'light', primaries.light, syntaxStyle, borderContrast),
    }])) as PreviewVariants;
}
