import { color, contrast, lch, readable } from './colors';
import { syntaxColors } from './syntax';
import { Appearance, balancedPolicy, ContrastPolicy, GeneratedTheme, Role, Swatch, TextMateRule, SyntaxStyle } from './model';

export const themeNames = { dark: 'Borrowed Light (Dark)', light: 'Borrowed Light (Light)' };
export const themeLabels = { dark: 'Borrowed Light (Dark)', light: 'Borrowed Light (Light)' };
export function generateTheme(palette: string[], appearance: Appearance, policy: ContrastPolicy = balancedPolicy, swatches: Swatch[] = [], primary: string = palette[2], syntaxStyle: SyntaxStyle = 'balanced'): GeneratedTheme {
    if (palette.length !== 5) { throw new Error('Expected five harmony colors'); }
    const seed = lch(primary);
    const dark = appearance === 'dark';
    const total = swatches.reduce((sum, swatch) => sum + swatch.weight, 0);
    const sourceLightness = total ? swatches.reduce((sum, swatch) => sum + lch(swatch.hex).l * swatch.weight, 0) / total : seed.l;
    const sourceChroma = total ? swatches.reduce((sum, swatch) => sum + lch(swatch.hex).c * swatch.weight, 0) / total : seed.c;
    // Near-white, fixed surfaces erased wallpaper differences. Use its brightness and colorfulness
    // for light surfaces, leaving enough lightness headroom for perceptible, in-gamut hue variation.
    const lightness = 0.91 + 0.045 * sourceLightness;
    const tint = dark ? Math.min(seed.c, 0.014) : Math.min(seed.c * 0.55, 0.03 + sourceChroma * 0.35);
    const bg = color(dark ? 0.15 : lightness, tint, seed.h);
    const panel = color(dark ? 0.19 : lightness - 0.06, dark ? tint : tint * 1.45, seed.h);
    const field = color(dark ? 0.22 : lightness - 0.09, dark ? tint : tint * 1.2, seed.h);
    const selection = color(dark ? 0.29 : lightness - 0.16, Math.min(seed.c, dark ? 0.025 : 0.09), seed.h);
    const hover = color(dark ? 0.25 : lightness - 0.12, dark ? tint : tint * 1.3, seed.h);
    const all = [bg, panel, field, selection, hover];
    const colors: Record<string, string> = {};
    const roles: Role[] = [];
    const role = (name: string, original: string, backgrounds = all, minimum = policy.text): string => {
        const adjusted = readable(original, backgrounds, minimum);
        roles.push({ name, original, adjusted, backgrounds, minimum });
        return adjusted;
    };
    const text = role('Primary text', color(dark ? 0.88 : 0.23, tint, seed.h));
    const muted = role('Secondary text', color(dark ? 0.63 : 0.49, tint, seed.h), all, policy.secondary);
    const accent = role('Accent text', primary);
    const buttonBg = color(dark ? 0.42 : 0.65, Math.min(seed.c, 0.1), seed.h);
    const buttonHover = color(dark ? 0.46 : 0.6, Math.min(seed.c, 0.1), seed.h);
    const indicator = role('Focus indicator', primary, [...all, buttonBg, buttonHover], policy.indicator);
    const buttonFg = role('Primary button text', text, [buttonBg, buttonHover]);
    const put = (keys: string[], value: string) => keys.forEach(key => { colors[key] = value; });
    put(['editor.background', 'terminal.background'], bg);
    put(['sideBar.background', 'activityBar.background', 'statusBar.background', 'statusBar.noFolderBackground', 'statusBar.debuggingBackground', 'titleBar.activeBackground', 'titleBar.inactiveBackground', 'panel.background', 'editorGroupHeader.tabsBackground', 'tab.inactiveBackground', 'notificationCenterHeader.background', 'notifications.background', 'editorWidget.background', 'menu.background', 'dropdown.background', 'quickInput.background', 'peekViewEditor.background', 'peekViewResult.background', 'peekViewTitle.background', 'surface.background'], panel);
    put(['input.background', 'settings.textInputBackground', 'settings.numberInputBackground', 'settings.dropdownBackground', 'list.inactiveSelectionBackground', 'editorSuggestWidget.background', 'badge.background', 'activityBarBadge.background', 'button.secondaryBackground', 'tab.activeBackground'], field);
    put(['editor.selectionBackground', 'editor.inactiveSelectionBackground', 'editor.selectionHighlightBackground', 'list.activeSelectionBackground', 'list.focusBackground', 'editorSuggestWidget.selectedBackground', 'terminal.selectionBackground', 'editor.findMatchBackground', 'editor.findMatchHighlightBackground', 'editor.wordHighlightBackground', 'editor.wordHighlightStrongBackground', 'editor.rangeHighlightBackground', 'menu.selectionBackground'], selection);
    put(['list.hoverBackground', 'button.secondaryHoverBackground', 'toolbar.hoverBackground'], hover);
    put(['foreground', 'editor.foreground', 'terminal.foreground', 'editor.selectionForeground', 'terminal.selectionForeground', 'sideBar.foreground', 'sideBarTitle.foreground', 'sideBarSectionHeader.foreground', 'activityBar.foreground', 'statusBar.foreground', 'statusBar.noFolderForeground', 'statusBar.debuggingForeground', 'titleBar.activeForeground', 'titleBar.inactiveForeground', 'tab.activeForeground', 'tab.inactiveForeground', 'input.foreground', 'settings.textInputForeground', 'settings.numberInputForeground', 'settings.dropdownForeground', 'dropdown.foreground', 'list.activeSelectionForeground', 'list.inactiveSelectionForeground', 'list.focusForeground', 'list.hoverForeground', 'editorSuggestWidget.foreground', 'editorSuggestWidget.selectedForeground', 'editorWidget.foreground', 'notifications.foreground', 'menu.foreground', 'menu.selectionForeground', 'quickInput.foreground', 'badge.foreground', 'activityBarBadge.foreground', 'button.secondaryForeground', 'peekViewEditorGutter.background', 'peekViewResult.fileForeground', 'peekViewResult.lineForeground', 'peekViewTitleLabel.foreground', 'surface.foreground'], text);
    // Gutter is a surface, not text.
    colors['peekViewEditorGutter.background'] = panel;
    put(['descriptionForeground', 'disabledForeground', 'input.placeholderForeground', 'editorLineNumber.foreground', 'activityBar.inactiveForeground', 'tab.unfocusedActiveForeground', 'tab.unfocusedInactiveForeground', 'peekViewTitleDescription.foreground'], muted);
    put(['textLink.foreground', 'textLink.activeForeground', 'editorCursor.foreground', 'editorLineNumber.activeForeground', 'progressBar.background', 'editorSuggestWidget.highlightForeground'], accent);
    put(['focusBorder', 'input.border', 'dropdown.border', 'button.border', 'editor.findMatchBorder', 'editorGroup.border', 'panel.border', 'widget.border', 'notifications.border', 'surface.border'], indicator);
    colors['button.background'] = buttonBg; colors['button.hoverBackground'] = buttonHover; colors['button.foreground'] = buttonFg;
    const error = role('Error', color(0.65, 0.16, 25));
    const warning = role('Warning', color(0.7, 0.13, 85));
    const success = role('Success', color(0.65, 0.13, 145));
    put(['errorForeground', 'editorError.foreground', 'list.errorForeground', 'terminal.ansiRed', 'terminal.ansiBrightRed', 'gitDecoration.deletedResourceForeground', 'inputValidation.errorBorder'], error);
    put(['editorWarning.foreground', 'list.warningForeground', 'terminal.ansiYellow', 'terminal.ansiBrightYellow', 'gitDecoration.modifiedResourceForeground', 'inputValidation.warningBorder'], warning);
    put(['terminal.ansiGreen', 'terminal.ansiBrightGreen', 'gitDecoration.addedResourceForeground'], success);
    put(['inputValidation.errorBackground', 'inputValidation.warningBackground', 'inputValidation.infoBackground'], field);
    put(['inputValidation.errorForeground', 'inputValidation.warningForeground', 'inputValidation.infoForeground'], text);
    put(['editorInfo.foreground', 'inputValidation.infoBorder'], accent);
    const comment = role('Comments', color(dark ? 0.6 : 0.5, tint, seed.h), all, policy.comment);
    const syntax = syntaxColors(swatches, palette, appearance, syntaxStyle);
    const vibrant = syntaxStyle === 'vibrant' || syntaxStyle === 'vibrant-alt';
    const identifiers = vibrant ? role('Variables and properties', syntax[5]) : text;
    const keywords = role('Keywords', syntax[0]);
    const strings = role('Strings', syntax[1]);
    const numbers = role('Numbers and constants', syntax[2]);
    const functions = role('Functions', syntax[3]);
    const types = role('Types', syntax[4]);
    const textMateRules: TextMateRule[] = [
        { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: comment } },
        { scope: ['keyword', 'storage'], settings: { foreground: keywords } },
        { scope: ['string', 'markup.inline.raw', 'markup.fenced_code', 'storage.type.string.python'], settings: { foreground: strings } },
        { scope: ['constant', 'constant.numeric', 'support.constant', 'storage.type.number.python', 'storage.type.imaginary.number.python'], settings: { foreground: numbers } },
        { scope: ['entity.name.function', 'support.function', 'meta.function-call.generic.python'], settings: { foreground: functions } },
        { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.other.inherited-class'], settings: { foreground: types } },
        { scope: ['variable', 'entity.name.variable', 'support.variable'], settings: { foreground: identifiers } },
        { scope: ['variable.parameter'], settings: { foreground: vibrant ? strings : text } },
        { scope: ['variable.other.property', 'support.variable.property'], settings: { foreground: vibrant ? types : text } },
        { scope: ['punctuation', 'meta.embedded'], settings: { foreground: text } },
        { scope: ['markup.heading', 'entity.name.tag'], settings: { foreground: keywords } },
        { scope: ['entity.other.attribute-name', 'markup.link'], settings: { foreground: functions } },
        { scope: ['invalid'], settings: { foreground: error } },
    ];
    const semanticRules: Record<string, string> = {
        '*': text, comment, string: strings, number: numbers, keyword: keywords, operator: text,
        function: functions, method: functions, type: types, class: types, interface: types, enum: types,
        typeParameter: types, namespace: types, struct: types, variable: identifiers, parameter: vibrant ? strings : text, property: vibrant ? types : text,
        enumMember: numbers, 'variable.readonly': numbers, decorator: functions, regexp: strings,
    };
    // ANSI status hues retain their meaning; all ANSI foregrounds remain readable on the base terminal.
    put(['terminal.ansiBlack', 'terminal.ansiBrightBlack'], muted);
    put(['terminal.ansiWhite', 'terminal.ansiBrightWhite'], text);
    put(['terminal.ansiBlue', 'terminal.ansiBrightBlue'], role('Terminal blue', color(0.65, 0.15, 255)));
    put(['terminal.ansiMagenta', 'terminal.ansiBrightMagenta'], role('Terminal magenta', color(0.65, 0.15, 320)));
    put(['terminal.ansiCyan', 'terminal.ansiBrightCyan'], role('Terminal cyan', color(0.65, 0.1, 200)));
    const checks = roles.flatMap(r => r.backgrounds.map(background => ({ role: r.name, foreground: r.adjusted, background, ratio: contrast(r.adjusted, background), minimum: r.minimum })));
    return { appearance, colors, textMateRules, semanticRules, roles, checks };
}
