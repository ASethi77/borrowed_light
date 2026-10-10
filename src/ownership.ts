export type Values = Record<string, unknown>;
export interface BlockLedger { before: Values; written: Values; originallyPresent?: boolean }
export interface Ledger {
    previousTheme?: string;
    activeTheme: string;
    sections: Record<string, { originallyAbsent: boolean; blocks: Record<string, BlockLedger> }>;
}
export function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export function object(value: unknown): Values { return value && typeof value === 'object' && !Array.isArray(value) ? value as Values : {}; }

/** Remember ORIGINAL values once; updates must never turn a generated value into the restoration baseline. */
export function mergeOwned(current: Values | undefined, block: string, generated: Values, previous?: BlockLedger): { value: Values; ledger: BlockLedger } {
    const existing = object(current?.[block]);
    const before = previous?.before ?? Object.fromEntries(Object.keys(generated).filter(key => Object.hasOwn(existing, key)).map(key => [key, existing[key]]));
    return { value: { ...current, [block]: { ...existing, ...generated } }, ledger: { before, written: generated, originallyPresent: previous?.originallyPresent ?? Object.hasOwn(current ?? {}, block) } };
}
export function restoreOwned(current: Values | undefined, block: string, ledger: BlockLedger): Values | undefined {
    if (!current || !Object.hasOwn(current, block)) { return current; }
    const value = { ...current }, existing = { ...object(current[block]) };
    for (const [key, generated] of Object.entries(ledger.written)) {
        if (!equal(existing[key], generated)) { continue; }
        if (Object.hasOwn(ledger.before, key)) { existing[key] = ledger.before[key]; } else { delete existing[key]; }
    }
    if (Object.keys(existing).length || ledger.originallyPresent) { value[block] = existing; } else { delete value[block]; }
    return value;
}
