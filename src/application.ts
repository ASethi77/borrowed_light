import * as vscode from 'vscode';
import { Appearance, GeneratedTheme, Harmony, PrimaryChoices, SyntaxStyle } from './model';
import { Ledger, Values, equal, mergeOwned, restoreOwned } from './ownership';
import { themeNames } from './color/theme';

const ledgerKey = 'themeOwnership.v1';
const previewKey = 'themePreview.v1';
interface PreviewJournal {
    ledgerBefore?: Ledger;
    previousTheme?: string;
    selectedThemes?: string[];
    sections: Ledger['sections'];
    settings: Record<string, { before?: unknown; written: unknown }>;
}
export const customizationSections = ['workbench.colorCustomizations', 'editor.tokenColorCustomizations', 'editor.semanticTokenColorCustomizations'];
export class ThemeApplication {
    constructor(private readonly state: vscode.Memento) {}
    get ledger(): Ledger | undefined { return this.state.get<Ledger>(ledgerKey); }
    get active(): string { return vscode.workspace.getConfiguration('workbench').get<string>('colorTheme', '') ; }
    get ownedThemeActive(): boolean { return Object.values(themeNames).includes(this.active); }
    async beginPreview(): Promise<void> {
        await this.recoverPreview();
        await this.state.update(previewKey, {
            ledgerBefore: this.ledger,
            previousTheme: vscode.workspace.getConfiguration().inspect<string>('workbench.colorTheme')?.globalValue,
            sections: {}, settings: {},
        } satisfies PreviewJournal);
    }
    private async trackPreview(section: string, current: Values | undefined, block: string, generated: Values): Promise<void> {
        const saved = this.state.get<PreviewJournal>(previewKey);
        if (!saved) { return; }
        const journal: PreviewJournal = JSON.parse(JSON.stringify(saved));
        const entry = journal.sections[section] ?? { originallyAbsent: current === undefined, blocks: {} };
        entry.blocks[block] = mergeOwned(current, block, generated, entry.blocks[block]).ledger;
        journal.sections[section] = entry;
        await this.state.update(previewKey, journal);
    }
    async recoverPreview(): Promise<void> { if (this.state.get(previewKey)) { await this.finishPreview(false); } }
    async finishPreview(keep: boolean): Promise<void> {
        const journal = this.state.get<PreviewJournal>(previewKey);
        if (!journal) { return; }
        if (!keep) {
            for (const [section, entry] of Object.entries(journal.sections)) {
                const config = vscode.workspace.getConfiguration();
                let current = config.inspect<Values>(section)?.globalValue;
                for (const [block, ownership] of Object.entries(entry.blocks)) { current = restoreOwned(current, block, ownership); }
                await config.update(section, entry.originallyAbsent && !Object.keys(current ?? {}).length ? undefined : current, vscode.ConfigurationTarget.Global);
            }
            const config = vscode.workspace.getConfiguration();
            for (const [key, entry] of Object.entries(journal.settings)) {
                if (equal(vscode.workspace.getConfiguration().inspect(key)?.globalValue, entry.written)) {
                    await config.update(key, entry.before, vscode.ConfigurationTarget.Global);
                }
            }
            if (journal.selectedThemes?.includes(this.active)) { await config.update('workbench.colorTheme', journal.previousTheme, vscode.ConfigurationTarget.Global); }
            await this.state.update(ledgerKey, journal.ledgerBefore);
        }
        await this.state.update(previewKey, undefined);
    }
    async commitPreview(harmony: Harmony, appearance: Appearance, primaries?: PrimaryChoices, syntaxStyle?: SyntaxStyle): Promise<void> {
        try {
            for (const [key, written] of Object.entries({ 'borrowed-light.harmony': harmony, 'borrowed-light.appearance': appearance, ...(syntaxStyle ? { 'borrowed-light.syntaxStyle': syntaxStyle } : {}), ...(primaries ? { 'borrowed-light.primaryDark': primaries.dark, 'borrowed-light.primaryLight': primaries.light } : {}) })) {
                const config = vscode.workspace.getConfiguration();
                const saved = this.state.get<PreviewJournal>(previewKey);
                if (!saved) { throw new Error('Preview session is no longer active'); }
                const journal: PreviewJournal = JSON.parse(JSON.stringify(saved));
                journal.settings[key] = { before: config.inspect(key)?.globalValue, written };
                await this.state.update(previewKey, journal);
                await config.update(key, written, vscode.ConfigurationTarget.Global);
            }
            await this.finishPreview(true);
        } catch (error) { await this.finishPreview(false); throw error; }
    }
    async apply(theme: GeneratedTheme, maySelect: () => boolean = () => true): Promise<boolean> {
        const config = vscode.workspace.getConfiguration();
        const originalLedger = this.ledger;
        const rollback: { section: string; before: unknown; written: unknown }[] = [];
        const name = themeNames[theme.appearance], block = `[${name}]`;
        const ledger: Ledger = JSON.parse(JSON.stringify(this.ledger ?? {
            previousTheme: config.inspect<string>('workbench.colorTheme')?.globalValue,
            activeTheme: name, sections: {},
        }));
        ledger.activeTheme = name;
        const generated: Values[] = [theme.colors, { textMateRules: theme.textMateRules }, { enabled: true, rules: theme.semanticRules }];
        try {
            for (let i = 0; i < customizationSections.length; i++) {
                const section = customizationSections[i];
                const current = config.inspect<Values>(section)?.globalValue;
                const sectionLedger = ledger.sections[section] ?? { originallyAbsent: current === undefined, blocks: {} };
                const merged = mergeOwned(current, block, generated[i], sectionLedger.blocks[block]);
                sectionLedger.blocks[block] = merged.ledger;
                ledger.sections[section] = sectionLedger;
                // Journal before writing so restart/crash restoration can identify even a partial application.
                await this.state.update(ledgerKey, ledger);
                await this.trackPreview(section, current, block, generated[i]);
                rollback.push({ section, before: current, written: merged.value });
                await config.update(section, merged.value, vscode.ConfigurationTarget.Global);
            }
            // Configuration writes yield to the UI. A user can select another theme during those awaits.
            if (!maySelect()) { return false; }
            const preview = this.state.get<PreviewJournal>(previewKey);
            if (preview) { await this.state.update(previewKey, { ...preview, selectedThemes: [...new Set([...(preview.selectedThemes ?? []), name])] }); }
            if (!maySelect()) { return false; }
            if (this.active !== name) {
                rollback.push({ section: 'workbench.colorTheme', before: config.inspect('workbench.colorTheme')?.globalValue, written: name });
                await config.update('workbench.colorTheme', name, vscode.ConfigurationTarget.Global);
            }
            return true;
        } catch (error) {
            let recovered = true;
            for (const entry of rollback.reverse()) {
                try {
                    const current = vscode.workspace.getConfiguration().inspect(entry.section)?.globalValue;
                    if (equal(current, entry.written)) {
                        await config.update(entry.section, entry.before, vscode.ConfigurationTarget.Global);
                    } else if (!equal(current, entry.before)) { recovered = false; }
                } catch { recovered = false; }
            }
            if (recovered) { await this.state.update(ledgerKey, originalLedger); }
            throw error;
        }
    }
    async restore(): Promise<void> {
        await this.recoverPreview();
        const ledger = this.ledger;
        if (!ledger) { return; }
        const config = vscode.workspace.getConfiguration();
        for (const [section, entry] of Object.entries(ledger.sections)) {
            let current = config.inspect<Values>(section)?.globalValue;
            for (const [block, ownership] of Object.entries(entry.blocks)) { current = restoreOwned(current, block, ownership); }
            await config.update(section, entry.originallyAbsent && !Object.keys(current ?? {}).length ? undefined : current, vscode.ConfigurationTarget.Global);
        }
        // Do not overwrite a theme the user selected after sync.
        if (this.ownedThemeActive) { await config.update('workbench.colorTheme', ledger.previousTheme, vscode.ConfigurationTarget.Global); }
        await this.state.update(ledgerKey, undefined);
    }
    configuredColors(theme: GeneratedTheme): Record<string, string> {
        const values = vscode.workspace.getConfiguration(undefined, vscode.window.activeTextEditor?.document.uri).get<Values>('workbench.colorCustomizations', {});
        const scoped = values[`[${themeNames[theme.appearance]}]`];
        const colors = { ...values, ...(scoped && typeof scoped === 'object' ? scoped : {}) };
        return Object.fromEntries(Object.entries(colors).filter(([key, value]) => key in theme.colors && typeof value === 'string')) as Record<string, string>;
    }
    overrideWarnings(theme: GeneratedTheme): string[] {
        const config = vscode.workspace.getConfiguration();
        const block = `[${themeNames[theme.appearance]}]`;
        const warnings: string[] = [];
        const configured = this.configuredColors(theme);
        if (Object.entries(configured).some(([key, value]) => value !== theme.colors[key])) {
            warnings.push('Saved workbench colors differ from this generated report. They may reflect manual edits or an earlier palette; compare the configured values below.');
        }
        for (const section of customizationSections) {
            const inspection = config.inspect<Values>(section);
            if (inspection?.workspaceValue || inspection?.workspaceFolderValue) { warnings.push(`${section} has workspace overrides; the rendered theme may differ from this report.`); }
            const global = inspection?.globalValue;
            if (global && Object.keys(global).some(key => key.startsWith('[') && key !== block && (key.includes('*') || key.includes(themeNames[theme.appearance])))) {
                warnings.push(`${section} has additional matching theme blocks; the rendered theme may differ.`);
            }
            if (section === 'editor.tokenColorCustomizations' && global && Object.hasOwn(global, 'textMateRules')) {
                warnings.push('Global TextMate rules may override generated syntax colors.');
            }
        }
        const languageId = vscode.window.activeTextEditor?.document.languageId;
        if (languageId) {
            const scoped = vscode.workspace.getConfiguration(undefined, { languageId, uri: vscode.window.activeTextEditor?.document.uri });
            for (const section of customizationSections) {
                const inspection = scoped.inspect(section);
                if (inspection?.globalLanguageValue || inspection?.workspaceLanguageValue || inspection?.workspaceFolderLanguageValue) {
                    warnings.push(`${section} has ${languageId}-specific overrides; rendered colors may differ.`);
                }
            }
        }
        if (config.get<boolean | string>('editor.semanticHighlighting.enabled') === false) { warnings.push('Semantic highlighting is disabled by your settings.'); }
        if (this.active !== themeNames[theme.appearance]) { warnings.push('This generated theme is not currently selected.'); }
        return warnings;
    }
}
