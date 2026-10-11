import { converter, clampChroma, formatHex } from 'culori';
import { HexColorCode, parseHexColorCode } from './code';

/** Perceptual lightness [0,1], nonnegative colorfulness, and hue angle in degrees.
 * OKLCH is cylindrical OKLab, not CIELCH: https://www.w3.org/TR/css-color-4/#ok-lab
 */
export interface OklchColor { lightness: number; chroma: number; hueDegrees: number }
export const fullHueTurnDegrees = 360;
const convertToOklch = converter('oklch');

export function toOklch(colorCode: HexColorCode): OklchColor {
    const converted = convertToOklch(colorCode);
    if (!converted) { throw new Error(`Invalid color: ${colorCode}`); }
    // Achromatic colors have no hue; zero gives deterministic downstream arithmetic.
    return { lightness: converted.l, chroma: converted.c, hueDegrees: converted.h ?? 0 };
}

/** Reduce chroma into the sRGB gamut before rounding to the final 8-bit hex color.
 * Culori's compact coordinate names are confined to this adapter.
 */
export function fromOklch({ lightness, chroma, hueDegrees }: OklchColor): HexColorCode {
    const mapped = clampChroma({
        mode: 'oklch', l: Math.max(0, Math.min(1, lightness)), c: Math.max(0, chroma),
        h: (hueDegrees % fullHueTurnDegrees + fullHueTurnDegrees) % fullHueTurnDegrees,
    }, 'oklch');
    return parseHexColorCode(formatHex(mapped));
}
