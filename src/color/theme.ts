import { HexColorCode } from './code';
import { fromOklch, toOklch } from './conversion';
import { contrastRatio, ensureReadableColor } from './contrast';
import { syntaxColors } from './syntax';
import { Appearance, balancedPolicy, ContrastPolicy, GeneratedTheme, Role, Swatch, TextMateRule, SyntaxStyle, BorderContrast } from '../model';

// Custom visual policy, expressed in OKLCH units. These values are deliberately kept
// separate from WCAG constants: they control appearance, not accessibility thresholds.
const surfacePolicy = {
    harmonySize: 5, automaticPrimaryIndex: 2,
    light: { baseLightness: 0.91, wallpaperLightnessScale: 0.045, primaryChromaScale: 0.55, baseChroma: 0.03, wallpaperChromaScale: 0.35 },
    dark: { backgroundLightness: 0.15, panelLightness: 0.19, fieldLightness: 0.22, selectionLightness: 0.29, hoverLightness: 0.25, maximumTintChroma: 0.014 },
    lightOffsets: { panel: 0.06, field: 0.09, selection: 0.16, hover: 0.12 },
    lightTintScales: { panel: 1.45, field: 1.2, hover: 1.3 },
    selectionChroma: { dark: 0.025, light: 0.09 },
    button: { darkLightness: 0.42, lightLightness: 0.65, darkHoverLightness: 0.46, lightHoverLightness: 0.6, maximumChroma: 0.1 },
};
const foregroundLightness = {
    primary: { dark: 0.88, light: 0.23 }, secondary: { dark: 0.63, light: 0.49 }, comment: { dark: 0.6, light: 0.5 },
};
// Diagnostic/ANSI colors keep conventional meanings independently of wallpaper harmony.
const statusColors = {
    error: { lightness: 0.65, chroma: 0.16, hueDegrees: 25 },
    warning: { lightness: 0.7, chroma: 0.13, hueDegrees: 85 },
    success: { lightness: 0.65, chroma: 0.13, hueDegrees: 145 },
    terminalBlue: { lightness: 0.65, chroma: 0.15, hueDegrees: 255 },
    terminalMagenta: { lightness: 0.65, chroma: 0.15, hueDegrees: 320 },
    terminalCyan: { lightness: 0.65, chroma: 0.1, hueDegrees: 200 },
};

export const themeNames = { dark: 'Borrowed Light (Dark)', light: 'Borrowed Light (Light)' };
export const themeLabels = { dark: 'Borrowed Light (Dark)', light: 'Borrowed Light (Light)' };
export function generateTheme(palette: HexColorCode[], appearance: Appearance, policy: ContrastPolicy = balancedPolicy, swatches: Swatch[] = [], primary: HexColorCode = palette[surfacePolicy.automaticPrimaryIndex], syntaxStyle: SyntaxStyle = 'balanced', borderContrast: BorderContrast = 'vibrant'): GeneratedTheme {
    if (palette.length !== surfacePolicy.harmonySize) { throw new Error('Expected five harmony colors'); }
    const primaryCoordinates = toOklch(primary);
    const dark = appearance === 'dark';
    const totalSwatchWeight = swatches.reduce((sum, swatch) => sum + swatch.weight, 0);
    // Weight averages by sampled opacity; empty swatches use the selected primary.
    const sourceLightness = totalSwatchWeight ? swatches.reduce((sum, swatch) => sum + toOklch(swatch.hex).lightness * swatch.weight, 0) / totalSwatchWeight : primaryCoordinates.lightness;
    const sourceChroma = totalSwatchWeight ? swatches.reduce((sum, swatch) => sum + toOklch(swatch.hex).chroma * swatch.weight, 0) / totalSwatchWeight : primaryCoordinates.chroma;
    // Near-white, fixed surfaces erased wallpaper differences. Use its brightness and colorfulness
    // for light surfaces, leaving enough lightness headroom for perceptible, in-gamut hue variation.
    const baseLightness = surfacePolicy.light.baseLightness + surfacePolicy.light.wallpaperLightnessScale * sourceLightness;
    const surfaceChroma = dark ? Math.min(primaryCoordinates.chroma, surfacePolicy.dark.maximumTintChroma) : Math.min(primaryCoordinates.chroma * surfacePolicy.light.primaryChromaScale, surfacePolicy.light.baseChroma + sourceChroma * surfacePolicy.light.wallpaperChromaScale);
    const editorBackground = fromOklch({ lightness: dark ? surfacePolicy.dark.backgroundLightness : baseLightness, chroma: surfaceChroma, hueDegrees: primaryCoordinates.hueDegrees });
    const panelBackground = fromOklch({ lightness: dark ? surfacePolicy.dark.panelLightness : baseLightness - surfacePolicy.lightOffsets.panel, chroma: dark ? surfaceChroma : surfaceChroma * surfacePolicy.lightTintScales.panel, hueDegrees: primaryCoordinates.hueDegrees });
    const fieldBackground = fromOklch({ lightness: dark ? surfacePolicy.dark.fieldLightness : baseLightness - surfacePolicy.lightOffsets.field, chroma: dark ? surfaceChroma : surfaceChroma * surfacePolicy.lightTintScales.field, hueDegrees: primaryCoordinates.hueDegrees });
    const selectionBackground = fromOklch({ lightness: dark ? surfacePolicy.dark.selectionLightness : baseLightness - surfacePolicy.lightOffsets.selection, chroma: Math.min(primaryCoordinates.chroma, surfacePolicy.selectionChroma[appearance]), hueDegrees: primaryCoordinates.hueDegrees });
    const hoverBackground = fromOklch({ lightness: dark ? surfacePolicy.dark.hoverLightness : baseLightness - surfacePolicy.lightOffsets.hover, chroma: dark ? surfaceChroma : surfaceChroma * surfacePolicy.lightTintScales.hover, hueDegrees: primaryCoordinates.hueDegrees });
    const textBackgrounds = [editorBackground, panelBackground, fieldBackground, selectionBackground, hoverBackground];
    const colors: Record<string, HexColorCode> = {};
    const roles: Role[] = [];
    // Resolve each foreground against every surface it can appear on, and retain
    // original/adjusted values for the report. Assignment order is intentionally stable.
    const assignReadableRole = (name: string, original: HexColorCode, backgrounds = textBackgrounds, minimum = policy.text): HexColorCode => {
        const adjusted = ensureReadableColor(original, backgrounds, minimum);
        roles.push({ name, original, adjusted, backgrounds, minimum });
        return adjusted;
    };
    const primaryText = assignReadableRole('Primary text', fromOklch({ lightness: foregroundLightness.primary[appearance], chroma: surfaceChroma, hueDegrees: primaryCoordinates.hueDegrees }));
    const secondaryText = assignReadableRole('Secondary text', fromOklch({ lightness: foregroundLightness.secondary[appearance], chroma: surfaceChroma, hueDegrees: primaryCoordinates.hueDegrees }), textBackgrounds, policy.secondary);
    const accent = assignReadableRole('Accent text', primary);
    const buttonBackground = fromOklch({ lightness: dark ? surfacePolicy.button.darkLightness : surfacePolicy.button.lightLightness, chroma: Math.min(primaryCoordinates.chroma, surfacePolicy.button.maximumChroma), hueDegrees: primaryCoordinates.hueDegrees });
    const buttonHoverBackground = fromOklch({ lightness: dark ? surfacePolicy.button.darkHoverLightness : surfacePolicy.button.lightHoverLightness, chroma: Math.min(primaryCoordinates.chroma, surfacePolicy.button.maximumChroma), hueDegrees: primaryCoordinates.hueDegrees });
    const indicator = assignReadableRole('Focus indicator', primary, [...textBackgrounds, buttonBackground, buttonHoverBackground], policy.indicator);
    const buttonForeground = assignReadableRole('Primary button text', primaryText, [buttonBackground, buttonHoverBackground]);
    const assignColors = (keys: string[], value: HexColorCode) => keys.forEach(key => { colors[key] = value; });
    assignColors(['editor.background', 'terminal.background'], editorBackground);
    assignColors(['sideBar.background', 'activityBar.background', 'statusBar.background', 'statusBar.noFolderBackground', 'statusBar.debuggingBackground', 'titleBar.activeBackground', 'titleBar.inactiveBackground', 'panel.background', 'editorGroupHeader.tabsBackground', 'tab.inactiveBackground', 'notificationCenterHeader.background', 'notifications.background', 'editorWidget.background', 'menu.background', 'dropdown.background', 'quickInput.background', 'peekViewEditor.background', 'peekViewResult.background', 'peekViewTitle.background', 'surface.background'], panelBackground);
    assignColors(['input.background', 'settings.textInputBackground', 'settings.numberInputBackground', 'settings.dropdownBackground', 'list.inactiveSelectionBackground', 'editorSuggestWidget.background', 'badge.background', 'activityBarBadge.background', 'button.secondaryBackground', 'tab.activeBackground'], fieldBackground);
    assignColors(['editor.selectionBackground', 'editor.inactiveSelectionBackground', 'editor.selectionHighlightBackground', 'list.activeSelectionBackground', 'list.focusBackground', 'editorSuggestWidget.selectedBackground', 'terminal.selectionBackground', 'editor.findMatchBackground', 'editor.findMatchHighlightBackground', 'editor.wordHighlightBackground', 'editor.wordHighlightStrongBackground', 'editor.rangeHighlightBackground', 'menu.selectionBackground'], selectionBackground);
    assignColors(['list.hoverBackground', 'button.secondaryHoverBackground', 'toolbar.hoverBackground'], hoverBackground);
    assignColors(['foreground', 'editor.foreground', 'terminal.foreground', 'editor.selectionForeground', 'terminal.selectionForeground', 'sideBar.foreground', 'sideBarTitle.foreground', 'sideBarSectionHeader.foreground', 'activityBar.foreground', 'statusBar.foreground', 'statusBar.noFolderForeground', 'statusBar.debuggingForeground', 'titleBar.activeForeground', 'titleBar.inactiveForeground', 'tab.activeForeground', 'tab.inactiveForeground', 'input.foreground', 'settings.textInputForeground', 'settings.numberInputForeground', 'settings.dropdownForeground', 'dropdown.foreground', 'list.activeSelectionForeground', 'list.inactiveSelectionForeground', 'list.focusForeground', 'list.hoverForeground', 'editorSuggestWidget.foreground', 'editorSuggestWidget.selectedForeground', 'editorWidget.foreground', 'notifications.foreground', 'menu.foreground', 'menu.selectionForeground', 'quickInput.foreground', 'badge.foreground', 'activityBarBadge.foreground', 'button.secondaryForeground', 'peekViewEditorGutter.background', 'peekViewResult.fileForeground', 'peekViewResult.lineForeground', 'peekViewTitleLabel.foreground', 'surface.foreground'], primaryText);
    // Gutter is a surface, not text.
    colors['peekViewEditorGutter.background'] = panelBackground;
    assignColors(['descriptionForeground', 'disabledForeground', 'input.placeholderForeground', 'editorLineNumber.foreground', 'activityBar.inactiveForeground', 'tab.unfocusedActiveForeground', 'tab.unfocusedInactiveForeground', 'peekViewTitleDescription.foreground'], secondaryText);
    assignColors(['textLink.foreground', 'textLink.activeForeground', 'editorCursor.foreground', 'editorLineNumber.activeForeground', 'progressBar.background', 'editorSuggestWidget.highlightForeground'], accent);
    assignColors(['focusBorder', 'input.border', 'dropdown.border', 'button.border', 'editor.findMatchBorder'], indicator);
    // Pane separators are decorative. Keep keyboard focus and control outlines at
    // their existing contrast target while letting the surrounding chrome recede.
    const border = borderContrast === 'vibrant' ? indicator : assignReadableRole('Pane borders',
        fromOklch({ lightness: toOklch(panelBackground).lightness, chroma: surfaceChroma, hueDegrees: primaryCoordinates.hueDegrees }),
        [editorBackground, panelBackground, fieldBackground], borderContrast === 'mellow' ? 1.15 : 1.5);
    assignColors(['editorGroup.border', 'panel.border', 'widget.border', 'notifications.border', 'surface.border'], border);
    colors['button.background'] = buttonBackground; colors['button.hoverBackground'] = buttonHoverBackground; colors['button.foreground'] = buttonForeground;
    const error = assignReadableRole('Error', fromOklch(statusColors.error));
    const warning = assignReadableRole('Warning', fromOklch(statusColors.warning));
    const success = assignReadableRole('Success', fromOklch(statusColors.success));
    assignColors(['errorForeground', 'editorError.foreground', 'list.errorForeground', 'terminal.ansiRed', 'terminal.ansiBrightRed', 'gitDecoration.deletedResourceForeground', 'inputValidation.errorBorder'], error);
    assignColors(['editorWarning.foreground', 'list.warningForeground', 'terminal.ansiYellow', 'terminal.ansiBrightYellow', 'gitDecoration.modifiedResourceForeground', 'inputValidation.warningBorder'], warning);
    assignColors(['terminal.ansiGreen', 'terminal.ansiBrightGreen', 'gitDecoration.addedResourceForeground'], success);
    assignColors(['inputValidation.errorBackground', 'inputValidation.warningBackground', 'inputValidation.infoBackground'], fieldBackground);
    assignColors(['inputValidation.errorForeground', 'inputValidation.warningForeground', 'inputValidation.infoForeground'], primaryText);
    assignColors(['editorInfo.foreground', 'inputValidation.infoBorder'], accent);
    const comment = assignReadableRole('Comments', fromOklch({ lightness: foregroundLightness.comment[appearance], chroma: surfaceChroma, hueDegrees: primaryCoordinates.hueDegrees }), textBackgrounds, policy.comment);
    const syntax = syntaxColors(swatches, palette, appearance, syntaxStyle);
    const vibrant = syntaxStyle === 'vibrant' || syntaxStyle === 'vibrant-alt';
    const identifiers = vibrant ? assignReadableRole('Variables and properties', syntax.identifiers) : primaryText;
    const keywords = assignReadableRole('Keywords', syntax.keywords);
    const strings = assignReadableRole('Strings', syntax.strings);
    const numbers = assignReadableRole('Numbers and constants', syntax.constants);
    const functions = assignReadableRole('Functions', syntax.functions);
    const types = assignReadableRole('Types', syntax.types);
    // Mirror named syntax families into grammar scopes and semantic token categories.
    // Neutral punctuation prevents broad embedded scopes from inheriting string colors.
    const textMateRules: TextMateRule[] = [
        { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: comment } },
        { scope: ['keyword', 'storage'], settings: { foreground: keywords } },
        { scope: ['string', 'markup.inline.raw', 'markup.fenced_code', 'storage.type.string.python'], settings: { foreground: strings } },
        { scope: ['constant', 'constant.numeric', 'support.constant', 'storage.type.number.python', 'storage.type.imaginary.number.python'], settings: { foreground: numbers } },
        { scope: ['entity.name.function', 'support.function', 'meta.function-call.generic.python'], settings: { foreground: functions } },
        { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.other.inherited-class'], settings: { foreground: types } },
        { scope: ['variable', 'entity.name.variable', 'support.variable'], settings: { foreground: identifiers } },
        { scope: ['variable.parameter'], settings: { foreground: vibrant ? strings : primaryText } },
        { scope: ['variable.other.property', 'support.variable.property'], settings: { foreground: vibrant ? types : primaryText } },
        { scope: ['punctuation', 'meta.embedded'], settings: { foreground: primaryText } },
        { scope: ['markup.heading', 'entity.name.tag'], settings: { foreground: keywords } },
        { scope: ['entity.other.attribute-name', 'markup.link'], settings: { foreground: functions } },
        { scope: ['invalid'], settings: { foreground: error } },
    ];
    const semanticRules: Record<string, HexColorCode> = {
        '*': primaryText, comment, string: strings, number: numbers, keyword: keywords, operator: primaryText,
        function: functions, method: functions, type: types, class: types, interface: types, enum: types,
        typeParameter: types, namespace: types, struct: types, variable: identifiers, parameter: vibrant ? strings : primaryText, property: vibrant ? types : primaryText,
        enumMember: numbers, 'variable.readonly': numbers, decorator: functions, regexp: strings,
    };
    // ANSI status hues retain their meaning; all ANSI foregrounds remain readable on the base terminal.
    assignColors(['terminal.ansiBlack', 'terminal.ansiBrightBlack'], secondaryText);
    assignColors(['terminal.ansiWhite', 'terminal.ansiBrightWhite'], primaryText);
    assignColors(['terminal.ansiBlue', 'terminal.ansiBrightBlue'], assignReadableRole('Terminal blue', fromOklch(statusColors.terminalBlue)));
    assignColors(['terminal.ansiMagenta', 'terminal.ansiBrightMagenta'], assignReadableRole('Terminal magenta', fromOklch(statusColors.terminalMagenta)));
    assignColors(['terminal.ansiCyan', 'terminal.ansiBrightCyan'], assignReadableRole('Terminal cyan', fromOklch(statusColors.terminalCyan)));
    const checks = roles.flatMap(assignedRole => assignedRole.backgrounds.map(background => ({ role: assignedRole.name, foreground: assignedRole.adjusted, background, ratio: contrastRatio(assignedRole.adjusted, background), minimum: assignedRole.minimum })));
    return { appearance, colors, textMateRules, semanticRules, roles, checks };
}
