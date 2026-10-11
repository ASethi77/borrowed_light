import { HexColorCode, parseHexColorCode } from './code';
import { Swatch } from '../model';

// Custom resource/quality choices, not requirements of the median-cut algorithm.
const extractionPolicy = { targetSamples: 65536, maximumSwatches: 8, discardedChannelBits: 3 };
const rgbaChannelsPerPixel = 4;
const maximumByteValue = 255;
const histogramChannelBits = 8 - extractionPolicy.discardedChannelBits;
const rgbAxes = ['red', 'green', 'blue'] as const;
interface WeightedRgbBin { red: number; green: number; blue: number; weight: number }

/** Describe the widest channel and opacity mass of a box. Stable sorting breaks equal
 * ranges in red/green/blue order, keeping extraction repeatable.
 */
function describeBox(box: WeightedRgbBin[]) {
    const channelRanges = rgbAxes.map(axis => ({
        axis, range: Math.max(...box.map(bin => bin[axis])) - Math.min(...box.map(bin => bin[axis])),
    }));
    channelRanges.sort((first, second) => second.range - first.range);
    return { ...channelRanges[0], weight: box.reduce((sum, bin) => sum + bin.weight, 0) };
}

/** Deterministic alpha-weighted median cut. Standard idea: repeatedly split RGB boxes
 * along their widest channel; this implementation prioritizes range × opacity mass.
 * Background: https://en.wikipedia.org/wiki/Median_cut
 */
export function extractRepresentativeColors(data: Uint8Array, width: number, height: number): Swatch[] {
    if (data.length !== width * height * rgbaChannelsPerPixel || width < 1 || height < 1) { throw new Error('Invalid RGBA image'); }
    const histogram = new Map<number, WeightedRgbBin>();
    const sampleStride = Math.max(1, Math.ceil(Math.sqrt(width * height / extractionPolicy.targetSamples)));
    // Sample a regular grid, then bin 8-bit channels to five bits each. Retain original
    // channel sums so bin centroids are not forced to quantized channel boundaries.
    // Opacity weights suppress transparent pixels without compositing onto an arbitrary background.
    for (let row = 0; row < height; row += sampleStride) {
        for (let column = 0; column < width; column += sampleStride) {
            const pixelOffset = (row * width + column) * rgbaChannelsPerPixel;
            const opacityWeight = data[pixelOffset + 3] / maximumByteValue;
            if (!opacityWeight) { continue; }
            const red = data[pixelOffset], green = data[pixelOffset + 1], blue = data[pixelOffset + 2];
            const histogramKey = ((red >> extractionPolicy.discardedChannelBits) << (histogramChannelBits * 2))
                | ((green >> extractionPolicy.discardedChannelBits) << histogramChannelBits)
                | (blue >> extractionPolicy.discardedChannelBits);
            const bin = histogram.get(histogramKey) ?? { red: 0, green: 0, blue: 0, weight: 0 };
            bin.red += red * opacityWeight; bin.green += green * opacityWeight; bin.blue += blue * opacityWeight; bin.weight += opacityWeight;
            histogram.set(histogramKey, bin);
        }
    }
    if (!histogram.size) { throw new Error('Wallpaper has no visible pixels'); }
    const boxes: WeightedRgbBin[][] = [[...histogram.values()].map(bin => ({
        red: bin.red / bin.weight, green: bin.green / bin.weight, blue: bin.blue / bin.weight, weight: bin.weight,
    }))];
    // Split the highest range × mass box at its weighted median. Equal priorities prefer
    // the earlier box; stable axis sorting retains histogram insertion order for ties.
    while (boxes.length < extractionPolicy.maximumSwatches) {
        const candidates = boxes.map((box, index) => ({ index, ...describeBox(box), count: box.length })).filter(box => box.count > 1);
        candidates.sort((first, second) => second.range * second.weight - first.range * first.weight || first.index - second.index);
        if (!candidates.length) { break; }
        const chosen = candidates[0];
        const box = boxes[chosen.index].sort((first, second) => first[chosen.axis] - second[chosen.axis]);
        let accumulatedWeight = 0, splitIndex = 0;
        while (splitIndex < box.length - 1 && accumulatedWeight < chosen.weight / 2) { accumulatedWeight += box[splitIndex++].weight; }
        splitIndex = Math.max(1, splitIndex);
        boxes.splice(chosen.index, 1, box.slice(0, splitIndex), box.slice(splitIndex));
    }
    // Each representative is the weighted RGB centroid, rounded to bytes. Merge boxes
    // producing identical hex values; report fractions of sampled visible opacity.
    const totalWeight = [...histogram.values()].reduce((sum, bin) => sum + bin.weight, 0);
    const combinedWeights = new Map<HexColorCode, number>();
    for (const box of boxes) {
        const boxWeight = box.reduce((sum, bin) => sum + bin.weight, 0);
        const colorCode = parseHexColorCode('#' + rgbAxes.map(axis => Math.round(box.reduce((sum, bin) => sum + bin[axis] * bin.weight, 0) / boxWeight).toString(16).padStart(2, '0')).join(''));
        combinedWeights.set(colorCode, (combinedWeights.get(colorCode) ?? 0) + boxWeight / totalWeight);
    }
    return [...combinedWeights].map(([hex, weight]) => ({ hex, weight })).sort((first, second) => second.weight - first.weight || first.hex.localeCompare(second.hex));
}
