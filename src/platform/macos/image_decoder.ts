import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeImageDecoder } from '../contracts';
import { ProcessRunner, runProcess } from '../process';
import { maxBytes } from '../../image/limits';

/** sips ships with macOS. Normalize a small, color-managed PNG outside the worker;
 * the original HEIC/JPEG may exceed the portable decoder's byte/pixel limits.
 */
export function macosImageDecoder(run: ProcessRunner = runProcess): NativeImageDecoder {
    const normalize = async (path: string, directory: string, signal: AbortSignal) => {
        if (signal.aborted) { throw new Error('Platform helper cancelled'); }
        if (!(await stat(path)).isFile()) { throw new Error('Wallpaper is not a regular file'); }
        const metadata = (await run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], { signal, timeoutMs: 5000 })).toString('utf8');
        const width = Number(/pixelWidth:\s*(\d+)/.exec(metadata)?.[1]);
        const height = Number(/pixelHeight:\s*(\d+)/.exec(metadata)?.[1]);
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) { throw new Error('macOS cannot read wallpaper dimensions'); }
        const output = join(directory, 'normalized.png');
        const resize = Math.max(width, height) > 1024 ? ['--resampleHeightWidthMax', '1024'] : [];
        await run('/usr/bin/sips', [...resize, '-s', 'format', 'png', path, '--out', output], { signal, timeoutMs: 15000 });
        if ((await stat(output)).size > maxBytes) { throw new Error('Normalized wallpaper exceeds the 64 MiB output limit'); }
        return readFile(output);
    };
    const withDirectory = async (action: (directory: string) => Promise<Uint8Array>) => {
        const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-image-'));
        try { return await action(directory); }
        finally { await rm(directory, { recursive: true, force: true }); }
    };
    const decoder: NativeImageDecoder = (bytes, signal) => withDirectory(async directory => {
        if (bytes.byteLength > maxBytes) { throw new Error('Wallpaper exceeds the 64 MiB input limit'); }
        const input = join(directory, 'source');
        await writeFile(input, bytes);
        return normalize(input, directory, signal);
    });
    decoder.fromFile = (path, signal) => withDirectory(directory => normalize(path, directory, signal));
    return decoder;
}
