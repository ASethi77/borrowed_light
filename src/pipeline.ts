import { NativeImageDecoder } from './platform/contracts';
import { nativeImageDecoder } from './platform/os_wallpaper';
import { maxBytes } from './image/limits';
import { ImagePolicy, imagePolicy, imageJobTimeoutMs, thumbnailByteLimit, thumbnailEdge } from './image/policy';
import { Worker } from 'node:worker_threads';
import { Appearance, Harmony, PaletteResult, PipelineInput, PreviewVariants, PrimaryChoice, PrimaryChoices, Swatch, SyntaxStyle, BorderContrast, BackgroundTint, BackgroundTints } from './model';

export class Cancelled extends Error { constructor() { super('Generation superseded or stopped'); } }
export interface PipelineOptions { imagePolicy?: ImagePolicy }
export function runPipeline(workerPath: string, path: string, harmony: Harmony, appearance: Appearance, signal?: AbortSignal, primary: PrimaryChoice = 'automatic', syntaxStyle: SyntaxStyle = 'balanced', decoder: NativeImageDecoder | undefined = nativeImageDecoder(), borderContrast: BorderContrast = 'balanced', backgroundTint: BackgroundTint = appearance === 'dark' ? 'colorful' : 'subtle', options: PipelineOptions = {}): Promise<PaletteResult> {
    return runWorker<PaletteResult>(workerPath, { path, harmony, appearance, primary, syntaxStyle, borderContrast, backgroundTint }, signal, decoder, options);
}
export function runPreviews(workerPath: string, source: Pick<PipelineInput, 'path' | 'swatches'>, signal?: AbortSignal, primaries?: PrimaryChoices, syntaxStyle: SyntaxStyle = 'balanced', decoder: NativeImageDecoder | undefined = nativeImageDecoder(), borderContrast: BorderContrast = 'balanced', backgroundTints: BackgroundTints = { light: 'subtle', dark: 'colorful' }, options: PipelineOptions = {}): Promise<PreviewVariants> {
    return runWorker<PreviewVariants>(workerPath, { ...source, previews: true, primaries, syntaxStyle, borderContrast, backgroundTints }, signal, decoder, options);
}
export function runVariant(workerPath: string, swatches: Swatch[], harmony: Harmony, appearance: Appearance, primary: PrimaryChoice, signal?: AbortSignal, syntaxStyle: SyntaxStyle = 'balanced', borderContrast: BorderContrast = 'balanced', backgroundTint: BackgroundTint = appearance === 'dark' ? 'colorful' : 'subtle'): Promise<PaletteResult> {
    return runWorker<PaletteResult>(workerPath, { swatches, harmony, appearance, primary, syntaxStyle, borderContrast, backgroundTint }, signal);
}
function runWorker<T>(workerPath: string, input: PipelineInput, signal?: AbortSignal, decoder?: NativeImageDecoder, options: PipelineOptions = {}): Promise<T> {
    if (signal?.aborted) { return Promise.reject(new Cancelled()); }
    return new Promise((resolve, reject) => {
        const policy = imagePolicy(options.imagePolicy?.maxMegapixels);
        const worker = new Worker(workerPath, { workerData: { ...input, nativeFileDecode: Boolean(input.path && decoder?.fromFile) }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
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
        const deadline = input.path && decoder?.fromFile ? imageJobTimeoutMs : 15000;
        const timer = setTimeout(() => finish(new Error(`Wallpaper processing exceeded ${deadline / 1000} seconds. Try a smaller image.`)), deadline);
        signal?.addEventListener('abort', abort, { once: true });
        worker.on('message', message => {
            if (message.nativeDecode || message.nativeDecodePath) {
                if (settled) { return; }
                const fromFile = message.nativeDecodePath !== undefined;
                if (nativeRequested || (fromFile
                    ? typeof message.nativeDecodePath !== 'string' || message.nativeDecodePath !== input.path || !decoder?.fromFile
                    : !(message.nativeDecode instanceof Uint8Array) || message.nativeDecode.byteLength > maxBytes)) { finish(new Error('Invalid native decoder request')); return; }
                nativeRequested = true;
                if (!decoder) { worker.postMessage({ error: 'Unsupported wallpaper format on this platform. JPEG/PNG work everywhere; native still-image decoding is available on Windows/macOS.' }); return; }
                void Promise.resolve().then(() => fromFile ? decoder.fromFile!(input.path!, helperAbort.signal, policy) : decoder(message.nativeDecode, helperAbort.signal, policy)).then(png => {
                    if (settled) { return; }
                    if (!(png instanceof Uint8Array) || png.byteLength > maxBytes) { finish(new Error('Normalized wallpaper exceeds the 64 MiB output limit')); return; }
                    if (fromFile) {
                        const header = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
                        if (png.byteLength > thumbnailByteLimit || png.byteLength < 24 || !header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || header.readUInt32BE(16) > thumbnailEdge || header.readUInt32BE(20) > thumbnailEdge) { finish(new Error('Native decoder returned invalid or oversized thumbnail PNG')); return; }
                    }
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
