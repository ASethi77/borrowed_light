import { Worker } from 'node:worker_threads';
import { Appearance, Harmony, PaletteResult } from './model';

export class Cancelled extends Error { constructor() { super('Generation superseded or stopped'); } }
export function runPipeline(workerPath: string, path: string, harmony: Harmony, appearance: Appearance, signal?: AbortSignal): Promise<PaletteResult> {
    if (signal?.aborted) { return Promise.reject(new Cancelled()); }
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath, { workerData: { path, harmony, appearance }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
        let settled = false;
        const finish = (error?: Error, result?: PaletteResult) => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            void worker.terminate();
            if (error) { reject(error); } else { resolve(result!); }
        };
        const abort = () => finish(new Cancelled());
        const timer = setTimeout(() => finish(new Error('Wallpaper processing exceeded 15 seconds. Try a smaller image.')), 15000);
        signal?.addEventListener('abort', abort, { once: true });
        worker.on('message', message => {
            if (message.error) { finish(new Error(message.error)); }
            else if (message.result) { finish(undefined, message.result as PaletteResult); }
            else { finish(new Error('Invalid palette worker result')); }
        });
        worker.on('error', error => finish(error));
        worker.on('exit', code => { if (!settled) { finish(new Error(`Palette worker exited without a result (${code})`)); } });
    });
}
