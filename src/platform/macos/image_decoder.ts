import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeImageDecoder } from '../contracts';
import { ProcessRunner, runProcess } from '../process';
import { ImagePolicy, checkDimensions, imageJobTimeoutMs, imagePolicy, sourceByteLimit, thumbnailByteLimit } from '../../image/policy';
import { inspectSource } from '../../image/metadata';

/** sips ships with macOS. Normalize a small, color-managed PNG outside the worker;
 * the original HEIC/JPEG may exceed the portable decoder's byte/pixel limits.
 */
export function macosImageDecoder(run: ProcessRunner = runProcess): NativeImageDecoder {
    const normalize = async (path: string, directory: string, signal: AbortSignal, policy: ImagePolicy) => {
        if (signal.aborted) { throw new Error('Platform helper cancelled'); }
        const before = await inspectSource(path, policy);
        const metadata = (await run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], { signal, timeoutMs: 5000 })).toString('utf8');
        // sips prints the literal filename before properties; use the last property
        // line so a filename containing newlines cannot supply fake dimensions.
        const width = Number([...metadata.matchAll(/^[ \t]*pixelWidth: *([0-9]+)[ \t]*$/gm)].at(-1)?.[1]);
        const height = Number([...metadata.matchAll(/^[ \t]*pixelHeight: *([0-9]+)[ \t]*$/gm)].at(-1)?.[1]);
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) { throw new Error('macOS cannot read wallpaper dimensions'); }
        checkDimensions(width, height, policy);
        const output = join(directory, 'normalized.png');
        const resize = Math.max(width, height) > 1024 ? ['--resampleHeightWidthMax', '1024'] : [];
        await run('/usr/bin/sips', [...resize, '-s', 'format', 'png', path, '--out', output], { signal, timeoutMs: imageJobTimeoutMs });
        if ((await stat(output)).size > thumbnailByteLimit) { throw new Error('Normalized wallpaper exceeds the 8 MiB output limit'); }
        if ((await inspectSource(path, policy)).fingerprint !== before.fingerprint) { throw new Error('Wallpaper changed during decoding; try syncing again'); }
        return readFile(output);
    };
    const withDirectory = async (action: (directory: string) => Promise<Uint8Array>) => {
        const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-image-'));
        try { return await action(directory); }
        finally { await rm(directory, { recursive: true, force: true }); }
    };
    const decoder: NativeImageDecoder = (bytes, signal, policy = imagePolicy()) => withDirectory(async directory => {
        if (bytes.byteLength > sourceByteLimit) { throw new Error('Wallpaper exceeds the 2 GiB input limit'); }
        const input = join(directory, 'source');
        await writeFile(input, bytes);
        return normalize(input, directory, signal, policy);
    });
    decoder.fromFile = (path, signal, policy = imagePolicy()) => withDirectory(directory => normalize(path, directory, signal, policy));
    Object.defineProperty(decoder, 'id', { value: 'macos-native' });
    return decoder;
}
