/** Source admission and thumbnail allocation are deliberately separate policies. */
export const sourceByteLimit = 2 * 1024 * 1024 * 1024;
// Match libjpeg's guarded edge bound; the shared megapixel ceiling is independent.
export const sourceEdgeLimit = 65_500;
export const thumbnailEdge = 1024;
export const thumbnailByteLimit = 8 * 1024 * 1024;
export const imageJobTimeoutMs = 120_000;
export interface ImagePolicy { maxMegapixels: number }
export function imagePolicy(maxMegapixels = 256): ImagePolicy {
    if (!Number.isInteger(maxMegapixels) || maxMegapixels < 1 || maxMegapixels > 512) {
        throw new Error('Image limit must be an integer between 1 and 512 megapixels');
    }
    return { maxMegapixels };
}
export function checkDimensions(width: number, height: number, policy: ImagePolicy): void {
    imagePolicy(policy.maxMegapixels);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) { throw new Error('Cannot read wallpaper dimensions'); }
    if (width > sourceEdgeLimit || height > sourceEdgeLimit) { throw new Error(`Wallpaper exceeds the ${sourceEdgeLimit}-pixel edge limit`); }
    if (width * height > policy.maxMegapixels * 1_000_000) { throw new Error(`Wallpaper exceeds the ${policy.maxMegapixels} megapixel input limit (${width} × ${height})`); }
}
