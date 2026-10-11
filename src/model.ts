import { HexColorCode } from './color/code';
import { indicatorContrast, normalTextContrast } from './color/contrast';

export const harmonies = ['analogous', 'monochromatic', 'triad', 'complementary', 'compound', 'shades'] as const;
export type Harmony = typeof harmonies[number];
export type Appearance = 'dark' | 'light';
export const syntaxStyles = ['mellow', 'balanced', 'vibrant', 'vibrant-alt'] as const;
export type SyntaxStyle = typeof syntaxStyles[number];
export type PrimaryChoice = 'automatic' | `wallpaper-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}` | `harmony-${1 | 2 | 3 | 4 | 5}`;
export type PrimaryChoices = Record<Appearance, PrimaryChoice>;
export interface PrimaryColor { id: PrimaryChoice; hex: HexColorCode; label: string }
export interface Swatch { hex: HexColorCode; weight: number }
export type { Wallpaper, WallpaperProvider, Disposable } from './platform/contracts';
export interface ContrastPolicy {
    readonly id: string;
    text: number;
    comment: number;
    secondary: number;
    indicator: number;
}
export const balancedPolicy: ContrastPolicy = { id: 'balanced', text: normalTextContrast, comment: normalTextContrast, secondary: normalTextContrast, indicator: indicatorContrast };
export interface ContrastCheck {
    role: string; foreground: HexColorCode; background: HexColorCode; ratio: number; minimum: number;
}
export interface Role {
    name: string; original: HexColorCode; adjusted: HexColorCode; backgrounds: HexColorCode[]; minimum: number;
}
export interface TextMateRule { scope: string[]; settings: { foreground: HexColorCode } }
export interface GeneratedTheme {
    appearance: Appearance;
    colors: Record<string, HexColorCode>;
    textMateRules: TextMateRule[];
    semanticRules: Record<string, HexColorCode>;
    roles: Role[];
    checks: ContrastCheck[];
}
export interface PaletteResult { swatches: Swatch[]; palette: HexColorCode[]; neutral: boolean; primary: PrimaryColor; syntaxStyle: SyntaxStyle; theme: GeneratedTheme }
export type PreviewVariants = Record<Harmony, Record<Appearance, PaletteResult>>;
export interface PipelineInput {
    path?: string;
    swatches?: Swatch[];
    harmony?: Harmony;
    appearance?: Appearance;
    previews?: boolean;
    primary?: PrimaryChoice;
    primaries?: PrimaryChoices;
    syntaxStyle?: SyntaxStyle;
}
