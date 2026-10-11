import { runProcess } from '../../process';

export type Run = (args: string[]) => Promise<string>;
export const runGsettings: Run = async args => (await runProcess('gsettings', args)).toString('utf8').trim();

/** GSettings prints a GVariant quoted string, not a shell expression. Never evaluate it. */
export function parseGvariant(input: string): string {
    const value = input.trim();
    const quote = value[0];
    if ((quote !== "'" && quote !== '"') || value.at(-1) !== quote) { throw new Error('Invalid GSettings string'); }
    let result = '';
    for (let i = 1; i < value.length - 1; i++) {
        if (value[i] === quote) { throw new Error('Unescaped quote in GSettings string'); }
        if (value[i] !== '\\') { result += value[i]; continue; }
        const escaped = value[++i];
        if (i >= value.length - 1) { throw new Error('Unterminated GSettings escape'); }
        const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', "'": "'", '"': '"' };
        if (escaped in simple) { result += simple[escaped]; }
        else if (escaped === 'u' || escaped === 'U' || escaped === 'x') {
            const length = escaped === 'u' ? 4 : escaped === 'U' ? 8 : 2;
            const digits = value.slice(i + 1, i + 1 + length);
            if (digits.length !== length || !/^[\da-f]+$/i.test(digits)) { throw new Error('Invalid GSettings escape'); }
            result += String.fromCodePoint(parseInt(digits, 16)); i += length;
        } else { throw new Error('Unknown GSettings escape'); }
    }
    return result;
}

