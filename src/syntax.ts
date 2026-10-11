import { color, lch } from './colors';
import { Appearance, Swatch, SyntaxStyle } from './model';

const hueDistance = (a: number, b: number) => Math.abs((a - b + 540) % 360 - 180);

/** Prefer separated observed hues so a dominant background does not bury small highlights. */
export function syntaxSources(swatches: Swatch[], fallback: string[]): string[] {
    const candidates = swatches.filter(swatch => lch(swatch.hex).c >= 0.025);
    if (!candidates.length) { return swatches.length ? [swatches[0].hex] : fallback; }
    const selected = [candidates[0].hex];
    while (selected.length < 6) {
        const remaining = candidates.filter(swatch => !selected.includes(swatch.hex)).map(swatch => ({
            ...swatch, distance: Math.min(...selected.map(hex => hueDistance(lch(hex).h, lch(swatch.hex).h))),
        })).sort((a, b) => b.distance - a.distance || b.weight - a.weight || a.hex.localeCompare(b.hex));
        if (!remaining.length || remaining[0].distance < 25) { break; }
        selected.push(remaining[0].hex);
    }
    return selected;
}

/** Keep observed and rule hues first; fill missing families by bisecting hue-wheel gaps. */
export function vibrantSources(swatches: Swatch[], palette: string[]): string[] {
    const candidates = [...syntaxSources(swatches, palette), ...palette].filter(hex => lch(hex).c >= 0.025);
    if (!candidates.length) { return syntaxSources(swatches, palette); }
    const selected = [candidates[0]];
    while (selected.length < 6) {
        const remaining = candidates.filter(hex => !selected.includes(hex)).map(hex => ({
            hex, distance: Math.min(...selected.map(chosen => hueDistance(lch(hex).h, lch(chosen).h))),
        })).sort((a, b) => b.distance - a.distance || a.hex.localeCompare(b.hex));
        if (!remaining.length || remaining[0].distance < 40) { break; }
        selected.push(remaining[0].hex);
    }
    while (selected.length < 6) {
        const hues = selected.map(hex => lch(hex).h).sort((a, b) => a - b);
        const gaps = hues.map((hue, index) => ({ hue, size: (hues[(index + 1) % hues.length] + (index === hues.length - 1 ? 360 : 0)) - hue }));
        gaps.sort((a, b) => b.size - a.size || a.hue - b.hue);
        selected.push(color(0.65, 0.16, gaps[0].hue + gaps[0].size / 2));
    }
    return selected;
}

/** Six semantic families: keywords, strings, constants, functions, types, identifiers. */
export function syntaxColors(swatches: Swatch[], fallback: string[], appearance: Appearance, style: SyntaxStyle): string[] {
    const sources = style === 'mellow' || style === 'balanced' ? fallback : vibrantSources(swatches, fallback);
    const rotation = style === 'vibrant-alt' ? 1 : 0;
    const vivid = style === 'vibrant' || style === 'vibrant-alt';
    return Array.from({ length: 6 }, (_, index) => {
        const source = lch(sources[(index + rotation) % sources.length]);
        const chroma = style === 'mellow' ? Math.min(source.c * 0.3, 0.045)
            : vivid ? (source.c < 0.025 ? 0 : Math.min(Math.max(source.c * 1.35, 0.14), 0.24))
                : Math.min(source.c * 0.7, 0.11);
        const lightness = (appearance === 'dark' ? 0.73 : 0.43) + [0.02, -0.02, 0.04, 0, -0.01, 0.01][index];
        return color(lightness, chroma, source.h);
    });
}
