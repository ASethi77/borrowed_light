import * as vscode from 'vscode';
import { ThemeApplication } from './application';
import { Appearance, harmonies, Harmony, PreviewVariants, PrimaryChoices, PaletteResult, PrimaryChoice, Swatch, SyntaxStyle, syntaxStyles, BorderContrast, borderContrasts, BackgroundTint } from './model';
import { primaryColors, resolvePrimary } from './primary';
import { generateVariant } from './variants';
import { Cancelled } from './pipeline';

export interface PreviewChoice { harmony: Harmony; appearance: Appearance; primaries?: PrimaryChoices; syntaxStyle?: SyntaxStyle; borderContrast?: BorderContrast }
export interface PreviewPicker { closed: Promise<PreviewChoice | undefined>; cancel(): Promise<PreviewChoice | undefined>; cyclePrimary(direction?: number): void; toggleAppearance(): void; cycleSyntax(direction?: number): void; cycleBorders(direction?: number): void }
interface PreviewOptions {
    application: ThemeApplication;
    prepare(signal: AbortSignal): Promise<PreviewChoice & { variants: PreviewVariants }>;
    enqueue(action: () => Promise<void>): Promise<void>;
    generate?(swatches: Swatch[], harmony: Harmony, appearance: Appearance, primary: PrimaryChoice, signal: AbortSignal, syntaxStyle: SyntaxStyle, borderContrast: BorderContrast, backgroundTint: BackgroundTint): Promise<PaletteResult>;
    error(error: unknown): void;
}
interface RuleItem extends vscode.QuickPickItem { rule: Harmony }

/** The picker previews the actual workbench. Settings change only when the user accepts. */
export function createPreviewPicker(options: PreviewOptions): PreviewPicker {
    const picker = vscode.window.createQuickPick<RuleItem>();
    const items = harmonies.map(rule => ({ label: rule[0].toUpperCase() + rule.slice(1), rule }));
    const previous: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('chevron-left'), tooltip: 'Previous color rule' };
    const next: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('chevron-right'), tooltip: 'Next color rule' };
    const brightness: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('color-mode'), tooltip: 'Toggle light/dark preview' };
    const previousPrimary: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('arrow-left'), tooltip: 'Previous primary color' };
    const nextPrimary: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('symbol-color'), tooltip: 'Next primary color (wallpaper and rule colors)' };
    const syntaxButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('symbol-keyword'), tooltip: 'Cycle syntax colors: mellow, balanced, vibrant, vibrant alternate' };
    const borderButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('layout-panel'), tooltip: 'Cycle border contrast: mellow, balanced, vibrant' };
    picker.title = 'Borrowed Light: Loading color schemes…';
    picker.placeholder = '↑/↓ rules · toolbar: primary / syntax / borders / light-dark · Enter keeps · Esc cancels';
    picker.items = items;
    picker.buttons = [previous, next, previousPrimary, nextPrimary, syntaxButton, borderButton, brightness];
    picker.ignoreFocusOut = false;
    picker.busy = true; picker.enabled = false;
    const abort = new AbortController();
    let variants: PreviewVariants | undefined;
    let appearance: Appearance = 'dark', harmony: Harmony = 'analogous';
    let primaries: PrimaryChoices = { dark: 'automatic', light: 'automatic' };
    let syntaxStyle: SyntaxStyle = 'balanced';
    let borderContrast: BorderContrast = 'vibrant';
    let generation: AbortController | undefined;
    const cache = new Map<string, PaletteResult>();
    let revision = 0, appliedKey = '', requestedKey = '';
    let finishing: 'commit' | 'cancel' | undefined;
    let finished: Promise<PreviewChoice | undefined> | undefined;
    let resolveClosed!: (choice: PreviewChoice | undefined) => void;
    const closed = new Promise<PreviewChoice | undefined>(resolve => { resolveClosed = resolve; });
    const subscriptions: vscode.Disposable[] = [];
    const selectionKey = () => `${harmony}/${appearance}/${primaries[appearance]}/${syntaxStyle}/${borderContrast}`;
    const title = () => {
        const base = variants?.[harmony][appearance];
        const primary = base && resolvePrimary(base.swatches, base.palette, primaries[appearance]);
        picker.title = `Borrowed Light: ${appearance === 'light' ? 'Light' : 'Dark'} · Syntax: ${syntaxStyle} · Borders: ${borderContrast} · ${primary ? `${primary.label} ${primary.hex}` : 'Loading'}`;
    };
    const request = () => {
        if (!variants || finishing || requestedKey === selectionKey()) { return; }
        requestedKey = selectionKey();
        const key = requestedKey, current = ++revision;
        const rule = harmony, mode = appearance, primary = primaries[appearance], style = syntaxStyle, borders = borderContrast, base = variants[rule][mode];
        generation?.abort(); generation = new AbortController();
        const signal = generation.signal;
        title();
        picker.busy = true;
        void options.enqueue(async () => {
            if (current !== revision || finishing === 'cancel') { return; }
            let result = cache.get(key);
            if (!result) {
                result = options.generate ? await options.generate(base.swatches, rule, mode, primary, signal, style, borders, base.backgroundTint) : generateVariant(base.swatches, rule, mode, primary, style, borders, base.backgroundTint);
                cache.set(key, result);
            }
            if (current !== revision) { return; }
            const applied = await options.application.apply(result.theme, () => current === revision && finishing !== 'cancel');
            if (applied && current === revision) { appliedKey = key; }
        }).catch(error => {
            if (!(error instanceof Cancelled) && current === revision && !finishing) { options.error(error); void finish(false); }
        }).finally(() => { if (current === revision && !finishing) { picker.busy = false; } });
    };
    const setup = (async () => {
        try {
            const prepared = await options.prepare(abort.signal);
            if (finishing) { return; }
            await options.application.beginPreview();
            if (finishing) { return; }
            variants = prepared.variants; appearance = prepared.appearance; harmony = prepared.harmony;
            primaries = { ...(prepared.primaries ?? primaries) };
            syntaxStyle = prepared.syntaxStyle ?? syntaxStyle;
            borderContrast = prepared.borderContrast ?? borderContrast;
            for (const rule of harmonies) {
                for (const mode of ['light', 'dark'] as Appearance[]) {
                    const result = variants[rule][mode];
                    cache.set(`${rule}/${mode}/${result.primary.id}/${result.syntaxStyle}/${result.borderContrast}`, result);
                }
            }
            title(); picker.activeItems = [items.find(item => item.rule === harmony)!];
            picker.enabled = true;
            request();
        } catch (error) {
            if (!(error instanceof Cancelled) && !finishing) { options.error(error); }
            if (!finishing) { queueMicrotask(() => { void finish(false); }); }
        }
    })();
    function finish(keep: boolean): Promise<PreviewChoice | undefined> {
        if (finished) { return finished; }
        finishing = keep ? 'commit' : 'cancel';
        if (!keep) { revision++; }
        abort.abort(); if (!keep) { generation?.abort(); } picker.enabled = false; picker.busy = true;
        finished = (async () => {
            let choice: PreviewChoice | undefined;
            try {
                await setup;
                await options.enqueue(async () => {
                    if (keep && appliedKey === selectionKey()) {
                        await options.application.commitPreview(harmony, appearance, primaries, syntaxStyle, borderContrast);
                        choice = { harmony, appearance, primaries: { ...primaries }, syntaxStyle, borderContrast };
                    } else { await options.application.finishPreview(false); }
                });
            } catch (error) {
                options.error(error);
                try { await options.enqueue(() => options.application.finishPreview(false)); } catch (recoveryError) { options.error(recoveryError); }
            } finally {
                picker.hide(); subscriptions.forEach(subscription => subscription.dispose()); picker.dispose();
                resolveClosed(choice);
            }
            return choice;
        })();
        return finished;
    }
    const cyclePrimary = (direction = 1) => {
        if (!variants || finishing) { return; }
        const base = variants[harmony][appearance], colors = primaryColors(base.swatches, base.palette);
        const index = Math.max(0, colors.findIndex(color => color.id === primaries[appearance]));
        primaries[appearance] = colors[(index + direction + colors.length) % colors.length].id;
        request();
    };
    const cycleSyntax = (direction = 1) => {
        if (!variants || finishing) { return; }
        syntaxStyle = syntaxStyles[(syntaxStyles.indexOf(syntaxStyle) + direction + syntaxStyles.length) % syntaxStyles.length];
        request();
    };
    const cycleBorders = (direction = 1) => {
        if (!variants || finishing) { return; }
        borderContrast = borderContrasts[(borderContrasts.indexOf(borderContrast) + direction + borderContrasts.length) % borderContrasts.length];
        request();
    };
    const toggleAppearance = () => {
        if (!variants || finishing) { return; }
        appearance = appearance === 'dark' ? 'light' : 'dark'; request();
    };
    subscriptions.push(
        picker.onDidChangeActive(active => { if (active[0] && !finishing) { harmony = active[0].rule; request(); } }),
        picker.onDidTriggerButton(button => {
            if (!variants || finishing) { return; }
            if (button === brightness) { toggleAppearance(); }
            else if (button === syntaxButton) { cycleSyntax(); }
            else if (button === borderButton) { cycleBorders(); }
            else if (button === previousPrimary || button === nextPrimary) { cyclePrimary(button === previousPrimary ? -1 : 1); }
            else {
                const index = (harmonies.indexOf(harmony) + (button === previous ? -1 : 1) + harmonies.length) % harmonies.length;
                harmony = harmonies[index]; picker.value = ''; picker.activeItems = [items[index]];
            }
            request();
        }),
        picker.onDidAccept(() => {
            if (!variants || finishing) { return; }
            harmony = (picker.selectedItems[0] ?? picker.activeItems[0])?.rule ?? harmony;
            request(); void finish(true);
        }),
        picker.onDidHide(() => { void finish(false); }),
    );
    picker.show();
    return { closed, cancel: () => finish(false), cyclePrimary, toggleAppearance, cycleSyntax, cycleBorders };
}
