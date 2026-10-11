import { HexColorCode, isHexColorCode, parseHexColorCode } from '../../color/code';
import { contrastRatio } from '../../color/contrast';
import { GeneratedTheme, Swatch } from '../../model';

// Compile-only contract checks. This function is never executed by either test runner.
export function checkColorContracts(rawValue: string, unknownValue: unknown, theme: GeneratedTheme): void {
    const validated: HexColorCode = parseHexColorCode(rawValue);
    contrastRatio(validated, theme.colors['editor.background']);
    if (isHexColorCode(unknownValue)) { contrastRatio(unknownValue, validated); }
    // @ts-expect-error Plain strings must be validated before calculations.
    contrastRatio(rawValue, validated);
    // @ts-expect-error Even a syntactically valid literal has not crossed the validation boundary.
    const unvalidated: HexColorCode = '#123456';
    // @ts-expect-error Swatches must carry opaque validated hex colors.
    const rawSwatch: Swatch = { hex: rawValue, weight: 1 };
    // @ts-expect-error Generated theme colors cannot accept raw settings strings.
    theme.colors['editor.background'] = rawValue;
    void unvalidated;
    void rawSwatch;
}
