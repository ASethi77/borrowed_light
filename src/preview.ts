import * as vscode from 'vscode';
import { ThemeApplication } from './application';
import { Appearance, harmonies, Harmony, PreviewVariants } from './model';
import { Cancelled } from './pipeline';

export interface PreviewChoice { harmony: Harmony; appearance: Appearance }
export interface PreviewPicker { closed: Promise<PreviewChoice | undefined>; cancel(): Promise<PreviewChoice | undefined> }
interface PreviewOptions {
    application: ThemeApplication;
    prepare(signal: AbortSignal): Promise<PreviewChoice & { variants: PreviewVariants }>;
    enqueue(action: () => Promise<void>): Promise<void>;
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
    picker.title = 'Wallpaper Paste: Loading color schemes…';
    picker.placeholder = '↑/↓ preview a rule · toolbar buttons cycle or toggle light/dark · Enter keeps · Escape cancels';
    picker.items = items;
    picker.buttons = [previous, next, brightness];
    picker.ignoreFocusOut = false;
    picker.busy = true; picker.enabled = false;
    const abort = new AbortController();
    let variants: PreviewVariants | undefined;
    let appearance: Appearance = 'dark', harmony: Harmony = 'analogous';
    let revision = 0, appliedKey = '', requestedKey = '';
    let finishing: 'commit' | 'cancel' | undefined;
    let finished: Promise<PreviewChoice | undefined> | undefined;
    let resolveClosed!: (choice: PreviewChoice | undefined) => void;
    const closed = new Promise<PreviewChoice | undefined>(resolve => { resolveClosed = resolve; });
    const subscriptions: vscode.Disposable[] = [];
    const selectionKey = () => `${harmony}/${appearance}`;
    const title = () => { picker.title = `Wallpaper Paste: ${appearance === 'light' ? 'Light' : 'Dark'} preview`; };
    const request = () => {
        if (!variants || finishing || requestedKey === selectionKey()) { return; }
        requestedKey = selectionKey();
        const key = requestedKey, current = ++revision, theme = variants[harmony][appearance].theme;
        picker.busy = true;
        void options.enqueue(async () => {
            if (current !== revision || finishing === 'cancel') { return; }
            const applied = await options.application.apply(theme, () => current === revision && finishing !== 'cancel');
            if (applied && current === revision) { appliedKey = key; }
        }).catch(error => {
            if (current === revision && !finishing) { options.error(error); void finish(false); }
        }).finally(() => { if (current === revision && !finishing) { picker.busy = false; } });
    };
    const setup = (async () => {
        try {
            const prepared = await options.prepare(abort.signal);
            if (finishing) { return; }
            await options.application.beginPreview();
            if (finishing) { return; }
            variants = prepared.variants; appearance = prepared.appearance; harmony = prepared.harmony;
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
        abort.abort(); picker.enabled = false; picker.busy = true;
        finished = (async () => {
            let choice: PreviewChoice | undefined;
            try {
                await setup;
                await options.enqueue(async () => {
                    if (keep && appliedKey === selectionKey()) {
                        await options.application.commitPreview(harmony, appearance);
                        choice = { harmony, appearance };
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
    subscriptions.push(
        picker.onDidChangeActive(active => { if (active[0] && !finishing) { harmony = active[0].rule; request(); } }),
        picker.onDidTriggerButton(button => {
            if (!variants || finishing) { return; }
            if (button === brightness) { appearance = appearance === 'dark' ? 'light' : 'dark'; title(); }
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
    return { closed, cancel: () => finish(false) };
}
