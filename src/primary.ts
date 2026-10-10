import { PrimaryChoice, PrimaryColor, Swatch } from './model';

export function isPrimaryChoice(value: unknown): value is PrimaryChoice {
    return typeof value === 'string' && /^(automatic|wallpaper-[1-8]|harmony-[1-5])$/.test(value);
}
/** Stable source slots rather than hex values: new wallpapers can reuse the same preference. */
export function primaryColors(swatches: Swatch[], palette: string[]): PrimaryColor[] {
    return [
        { id: 'automatic', hex: palette[2], label: 'Automatic' },
        ...swatches.slice(0, 8).map((swatch, index) => ({ id: `wallpaper-${index + 1}` as PrimaryChoice, hex: swatch.hex, label: `Wallpaper ${index + 1} (${Math.round(swatch.weight * 100)}%)` })),
        ...palette.map((hex, index) => ({ id: `harmony-${index + 1}` as PrimaryChoice, hex, label: `Rule color ${index + 1}` })),
    ];
}
export function resolvePrimary(swatches: Swatch[], palette: string[], choice: PrimaryChoice): PrimaryColor {
    const colors = primaryColors(swatches, palette);
    return colors.find(color => color.id === choice) ?? colors[0];
}
