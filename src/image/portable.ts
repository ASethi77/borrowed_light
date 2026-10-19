import { Worker } from 'node:worker_threads';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeImageDecoder } from '../platform/contracts';
import { imageJobTimeoutMs, imagePolicy } from './policy';
import { inspectSource } from './metadata';

export interface PortableMetrics { wasmMemoryBytes: number; heapUsed: number; external: number; arrayBuffers: number }
/** Each job gets a fresh WASM instance. Worker termination releases all codec allocations. */
export function portableImageDecoder(workerPath: string, metrics?: (value: PortableMetrics) => void): NativeImageDecoder {
    const decoder: NativeImageDecoder = async (bytes, signal, policy = imagePolicy()) => {
        const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-portable-'));
        try {
            const path = join(directory, 'source'); await writeFile(path, bytes);
            return await decoder.fromFile!(path, signal, policy);
        } finally { await rm(directory, { recursive: true, force: true }); }
    };
    decoder.fromFile = async (path, signal, policy = imagePolicy()) => {
        if (signal.aborted) { throw new Error('Image decoding cancelled'); }
        const source = await inspectSource(path, policy);
        if (source.format === 'native') { throw new Error('Portable decoding supports JPEG/PNG wallpapers'); }
        if (signal.aborted) { throw new Error('Image decoding cancelled'); }
        const png = await new Promise<Uint8Array>((resolve, reject) => {
            const worker = new Worker(workerPath, { workerData: { path, policy, format: source.format }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
            let settled = false;
            const stop = (error?: Error, result?: Uint8Array) => {
                if (settled) { return; }
                settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
                void worker.terminate().then(() => error ? reject(error) : resolve(result!));
            };
            const abort = () => stop(new Error('Image decoding cancelled'));
            const timer = setTimeout(() => stop(new Error('Portable image decoding exceeded 120 seconds')), imageJobTimeoutMs);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) { abort(); }
            worker.on('message', message => {
                if (message.error) { stop(new Error(message.error)); }
                else if (message.png instanceof Uint8Array) { metrics?.(message.metrics); stop(undefined, message.png); }
                else { stop(new Error('Invalid portable decoder result')); }
            });
            worker.on('error', error => stop(error));
            worker.on('exit', code => { if (!settled) { stop(new Error(`Portable decoder exited without a result (${code})`)); } });
        });
        if ((await inspectSource(path, policy)).fingerprint !== source.fingerprint) { throw new Error('Wallpaper changed during decoding; try syncing again'); }
        return png;
    };
    Object.defineProperty(decoder, 'id', { value: 'portable' });
    return decoder;
}
