import { converter, clampChroma, formatHex } from 'culori';
import { Harmony, Swatch } from './model';

const oklch = converter('oklch');
export function lch(hex: string): { l: number; c: number; h: number } {
    const value = oklch(hex);
    if (!value) { throw new Error(`Invalid color: ${hex}`); }
    return { l: value.l, c: value.c, h: value.h ?? 0 };
}
export function color(l: number, c: number, h: number): string {
    return formatHex(clampChroma({ mode: 'oklch', l: Math.max(0, Math.min(1, l)), c: Math.max(0, c), h: (h % 360 + 360) % 360 }, 'oklch'))!;
}
export function luminance(hex: string): number {
    const channels = hex.slice(1).match(/../g)!.slice(0, 3).map(value => {
        const channel = parseInt(value, 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrast(a: string, b: string): number {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function matrix(colors: string[]): number[][] { return colors.map(a => colors.map(b => contrast(a, b))); }

/** Deterministic, alpha-weighted median cut over a bounded, regularly sampled RGB histogram. */
export function extract(data: Uint8Array, width: number, height: number): Swatch[] {
    if (data.length !== width * height * 4 || width < 1 || height < 1) { throw new Error('Invalid RGBA image'); }
    type Bin = { r: number; g: number; b: number; weight: number };
    const bins = new Map<number, Bin>();
    const stride = Math.max(1, Math.ceil(Math.sqrt(width * height / 65536)));
    for (let y = 0; y < height; y += stride) {
        for (let x = 0; x < width; x += stride) {
            const i = (y * width + x) * 4, weight = data[i + 3] / 255;
            if (!weight) { continue; }
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
            const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
            bin.r += r * weight; bin.g += g * weight; bin.b += b * weight; bin.weight += weight;
            bins.set(key, bin);
        }
    }
    if (!bins.size) { throw new Error('Wallpaper has no visible pixels'); }
    let boxes: Bin[][] = [[...bins.values()].map(bin => ({ r: bin.r / bin.weight, g: bin.g / bin.weight, b: bin.b / bin.weight, weight: bin.weight }))];
    const describe = (box: Bin[]) => {
        const ranges = (['r', 'g', 'b'] as const).map(axis => ({ axis, range: Math.max(...box.map(b => b[axis])) - Math.min(...box.map(b => b[axis])) }));
        ranges.sort((a, b) => b.range - a.range);
        return { ...ranges[0], weight: box.reduce((sum, b) => sum + b.weight, 0) };
    };
    while (boxes.length < 8) {
        const candidates = boxes.map((box, index) => ({ index, ...describe(box), count: box.length })).filter(b => b.count > 1);
        candidates.sort((a, b) => b.range * b.weight - a.range * a.weight || a.index - b.index);
        if (!candidates.length) { break; }
        const chosen = candidates[0], box = boxes[chosen.index].sort((a, b) => a[chosen.axis] - b[chosen.axis]);
        let weight = 0, split = 0;
        while (split < box.length - 1 && weight < chosen.weight / 2) { weight += box[split++].weight; }
        split = Math.max(1, split);
        boxes.splice(chosen.index, 1, box.slice(0, split), box.slice(split));
    }
    const total = [...bins.values()].reduce((sum, b) => sum + b.weight, 0);
    const combined = new Map<string, number>();
    for (const box of boxes) {
        const weight = box.reduce((sum, b) => sum + b.weight, 0);
        const hex = '#' + (['r', 'g', 'b'] as const).map(axis => Math.round(box.reduce((sum, b) => sum + b[axis] * b.weight, 0) / weight).toString(16).padStart(2, '0')).join('');
        combined.set(hex, (combined.get(hex) ?? 0) + weight / total);
    }
    return [...combined].map(([hex, weight]) => ({ hex, weight })).sort((a, b) => b.weight - a.weight || a.hex.localeCompare(b.hex));
}

export function harmonize(swatches: Swatch[], mode: Harmony): { palette: string[]; neutral: boolean } {
    if (!swatches.length) { throw new Error('No extracted colors'); }
    const seed = swatches.find(s => lch(s.hex).c >= 0.025 && s.weight >= 0.01);
    const neutral = !seed;
    const { l, c, h } = lch((seed ?? swatches[0]).hex);
    const chroma = neutral ? 0 : Math.min(c, 0.18);
    const levels = [0.35, 0.45, 0.55, 0.65, 0.75];
    let palette: string[];
    switch (mode) {
        case 'analogous': palette = [-60, -30, 0, 30, 60].map(offset => color(0.65, chroma, h + offset)); break;
        case 'triad': palette = [color(0.55, chroma, h), color(0.65, chroma, h + 120), color(0.65, chroma, h + 240), color(0.75, chroma * 0.65, h), color(0.75, chroma * 0.65, h + 120)]; break;
        case 'complementary': palette = [color(0.55, chroma, h), color(0.7, chroma, h), color(0.65, chroma, h + 180), color(0.75, chroma * 0.65, h + 180), color(0.8, chroma * 0.4, h)]; break;
        case 'compound': palette = [0, -30, 30, 150, 210].map(offset => color(0.65, chroma, h + offset)); break;
        case 'monochromatic': palette = levels.map((lightness, i) => color(lightness, chroma * [0.3, 0.6, 0.85, 1, 0.5][i], h)); break;
        case 'shades': palette = [0, 0.1, 0.2, 0.3, 0.4].map(delta => color(Math.max(0.1, l - delta), chroma, h)); break;
    }
    return { palette, neutral };
}

/** Find the nearest lightness whose FINAL 8-bit sRGB value meets every assigned background. */
export function readable(original: string, backgrounds: string[], minimum: number): string {
    if (backgrounds.every(bg => contrast(original, bg) >= minimum)) { return original; }
    const value = lch(original);
    let best: string | undefined, distance = Infinity;
    for (let i = 0; i <= 1000; i++) {
        const candidate = color(i / 1000, value.c, value.h);
        const delta = Math.abs(i / 1000 - value.l);
        if (delta < distance && backgrounds.every(bg => contrast(candidate, bg) >= minimum)) { best = candidate; distance = delta; }
    }
    if (best) { return best; }
    for (const candidate of ['#000000', '#ffffff']) {
        if (backgrounds.every(bg => contrast(candidate, bg) >= minimum)) { return candidate; }
    }
    throw new Error('Cannot meet contrast targets against all assigned surfaces');
}
