/** An opaque, six-digit sRGB color. The brand disappears during JSON/worker serialization. */
declare const hexColorCodeBrand: unique symbol;
export type HexColorCode = string & { readonly [hexColorCodeBrand]: true };

/** CSS shorthand, alpha channels and named colors are deliberately outside the pipeline contract. */
export function isHexColorCode(value: unknown): value is HexColorCode {
    return typeof value === 'string' && value.length === 7 && /^#[\da-f]{6}$/i.test(value);
}

/** Validate a boundary value without normalizing spelling (including uppercase hex digits). */
export function parseHexColorCode(value: unknown): HexColorCode {
    if (!isHexColorCode(value)) { throw new Error(`Invalid opaque hex color: ${String(value)}`); }
    return value;
}
