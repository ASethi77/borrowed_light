import { NativeImageDecoder } from './platform/contracts';
import { nativeImageDecoder } from './platform/os_wallpaper';
import { maxBytes } from './image/limits';
import { Worker } from 'node:worker_threads';
import { Appearance, Harmony, PaletteResult, PipelineInput, PreviewVariants, PrimaryChoice, PrimaryChoices, Swatch, SyntaxStyle } from './model';

export class Cancelled extends Error { constructor() { super('Generation superseded or stopped'); } }
export function runPipeline(workerPath: string, path: string, harmony: Harmony, appearance: Appearance, signal?: AbortSignal, primary: PrimaryChoice = 'automatic', syntaxStyle: SyntaxStyle = 'balanced', decoder: NativeImageDecoder | undefined = nativeImageDecoder()): Promise<PaletteResult> {
    return runWorker<PaletteResult>(workerPath, { path, harmony, appearance, primary, syntaxStyle }, signal, decoder);
}
export function runPreviews(workerPath: string, source: Pick<PipelineInput, 'path' | 'swatches'>, signal?: AbortSignal, primaries?: PrimaryChoices, syntaxStyle: SyntaxStyle = 'balanced', decoder: NativeImageDecoder | undefined = nativeImageDecoder()): Promise<PreviewVariants> {
    return runWorker<PreviewVariants>(workerPath, { ...source, previews: true, primaries, syntaxStyle }, signal, decoder);
}
export function runVariant(workerPath: string, swatches: Swatch[], harmony: Harmony, appearance: Appearance, primary: PrimaryChoice, signal?: AbortSignal, syntaxStyle: SyntaxStyle = 'balanced'): Promise<PaletteResult> {
    return runWorker<PaletteResult>(workerPath, { swatches, harmony, appearance, primary, syntaxStyle }, signal);
}
function runWorker<T>(workerPath: string, input: PipelineInput, signal?: AbortSignal, decoder?: NativeImageDecoder): Promise<T> {
    if (signal?.aborted) { return Promise.reject(new Cancelled()); }
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath, { workerData: input, resourceLimits: { maxOldGenerationSizeMb: 128 } });
        let settled = false, nativeRequested = false;
        const helperAbort = new AbortController();
        const finish = (error?: Error, result?: T) => {
            if (settled) { return; }
            settled = true;
            helperAbort.abort();
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            void worker.terminate();
            if (error) { reject(error); } else { resolve(result!); }
        };
        const abort = () => finish(new Cancelled());
        const timer = setTimeout(() => finish(new Error('Wallpaper processing exceeded 15 seconds. Try a smaller image.')), 15000);
        signal?.addEventListener('abort', abort, { once: true });
        worker.on('message', message => {
            if (message.nativeDecode) {
                if (settled) { return; }
                if (nativeRequested || !(message.nativeDecode instanceof Uint8Array) || message.nativeDecode.byteLength > maxBytes) { finish(new Error('Invalid native decoder request')); return; }
                nativeRequested = true;
                if (!decoder) { worker.postMessage({ error: 'Unsupported wallpaper format on this platform. JPEG/PNG work everywhere; native still-image decoding is available on Windows/macOS.' }); return; }
                void Promise.resolve().then(() => decoder(message.nativeDecode, helperAbort.signal)).then(png => {
                    if (settled) { return; }
                    if (!(png instanceof Uint8Array) || png.byteLength > maxBytes) { finish(new Error('Normalized wallpaper exceeds the 64 MiB output limit')); return; }
                    const transferred = Uint8Array.from(png);
                    worker.postMessage({ png: transferred }, [transferred.buffer]);
                }).catch(error => { if (!settled) { finish(error instanceof Error ? error : new Error(String(error))); } });
            }
            else if (message.error) { finish(new Error(message.error)); }
            else if (message.result) { finish(undefined, message.result as T); }
            else { finish(new Error('Invalid palette worker result')); }
        });
        worker.on('error', error => finish(error));
        worker.on('exit', code => { if (!settled) { finish(new Error(`Palette worker exited without a result (${code})`)); } });
    });
}
