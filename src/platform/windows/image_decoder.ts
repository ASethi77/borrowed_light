import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeImageDecoder } from '../contracts';
import { ProcessRunner, runProcess } from '../process';
import { imageJobTimeoutMs, imagePolicy, thumbnailByteLimit } from '../../image/policy';
import { inspectSource } from '../../image/metadata';
import { imageScript } from './scripts';
import { powershellArguments, powershellExecutable } from './wallpaper';

export function windowsImageDecoder(run: ProcessRunner = runProcess): NativeImageDecoder {
    const decoder: NativeImageDecoder = async (bytes, signal, policy = imagePolicy()) => {
        const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-image-'));
        try {
            const path = join(directory, 'source');
            await writeFile(path, bytes);
            return await decoder.fromFile!(path, signal, policy);
        } finally { await rm(directory, { recursive: true, force: true }); }
    };
    decoder.fromFile = async (path, signal, policy = imagePolicy()) => {
        const before = await inspectSource(path, policy);
        const png = await run(powershellExecutable(), powershellArguments(imageScript), {
            input: Buffer.from(JSON.stringify({ path, maxPixels: policy.maxMegapixels * 1_000_000 })),
            signal, timeoutMs: imageJobTimeoutMs, maxOutputBytes: thumbnailByteLimit,
        });
        if ((await inspectSource(path, policy)).fingerprint !== before.fingerprint) { throw new Error('Wallpaper changed during decoding; try syncing again'); }
        return png;
    };
    Object.defineProperty(decoder, 'id', { value: 'windows-native' });
    return decoder;
}
