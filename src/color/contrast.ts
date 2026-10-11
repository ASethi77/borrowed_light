import { HexColorCode, parseHexColorCode } from './code';
import { fromOklch, toOklch } from './conversion';

// WCAG's sRGB transfer function and relative-luminance coefficients, not palette tuning.
// https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
const srgb = {
    maximumChannel: 255, linearThreshold: 0.04045, linearDivisor: 12.92,
    offset: 0.055, scale: 1.055, exponent: 2.4,
    redWeight: 0.2126, greenWeight: 0.7152, blueWeight: 0.0722,
};
const contrastLuminanceOffset = 0.05;
// Custom search resolution: examine 1,001 lightness values including black and white endpoints.
const readabilityLightnessSteps = 1000;
const fallbackColors = ['#000000', '#ffffff'].map(parseHexColorCode);
export const normalTextContrast = 4.5;
export const indicatorContrast = 3;

/** Linearize encoded sRGB channels before combining their contributions to luminance. */
export function relativeLuminance(colorCode: HexColorCode): number {
    const linearChannels = colorCode.slice(1).match(/../g)!.map(channelCode => {
        const encodedChannel = parseInt(channelCode, 16) / srgb.maximumChannel;
        return encodedChannel <= srgb.linearThreshold ? encodedChannel / srgb.linearDivisor
            : ((encodedChannel + srgb.offset) / srgb.scale) ** srgb.exponent;
    });
    return linearChannels[0] * srgb.redWeight + linearChannels[1] * srgb.greenWeight + linearChannels[2] * srgb.blueWeight;
}

/** Symmetric WCAG contrast ratio [1,21]; targets depend on the assigned UI role.
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */
export function contrastRatio(colorCodeA: HexColorCode, colorCodeB: HexColorCode): number {
    const luminanceA = relativeLuminance(colorCodeA), luminanceB = relativeLuminance(colorCodeB);
    return (Math.max(luminanceA, luminanceB) + contrastLuminanceOffset) / (Math.min(luminanceA, luminanceB) + contrastLuminanceOffset);
}
export function contrastMatrix(colorCodes: HexColorCode[]): number[][] {
    return colorCodes.map(rowColor => colorCodes.map(columnColor => contrastRatio(rowColor, columnColor)));
}

/** Find the nearest sampled lightness passing every surface. Check FINAL quantized sRGB,
 * since gamut mapping and 8-bit rounding can invalidate an unrounded contrast estimate.
 * This exhaustive search is a custom policy, not a WCAG algorithm. Ascending traversal and
 * strict distance comparison retain the darker candidate when distances tie.
 */
export function ensureReadableColor(original: HexColorCode, backgrounds: HexColorCode[], minimumContrast: number): HexColorCode {
    const passesEverySurface = (candidate: HexColorCode) => backgrounds.every(background => contrastRatio(candidate, background) >= minimumContrast);
    if (passesEverySurface(original)) { return original; }
    const originalCoordinates = toOklch(original);
    let nearestColor: HexColorCode | undefined, nearestDistance = Infinity;
    for (let step = 0; step <= readabilityLightnessSteps; step++) {
        const lightness = step / readabilityLightnessSteps;
        const candidate = fromOklch({ ...originalCoordinates, lightness });
        const lightnessDistance = Math.abs(lightness - originalCoordinates.lightness);
        if (lightnessDistance < nearestDistance && passesEverySurface(candidate)) {
            nearestColor = candidate;
            nearestDistance = lightnessDistance;
        }
    }
    if (nearestColor) { return nearestColor; }
    for (const candidate of fallbackColors) {
        if (passesEverySurface(candidate)) { return candidate; }
    }
    throw new Error('Cannot meet contrast targets against all assigned surfaces');
}
