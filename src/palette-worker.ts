import { parseHexColorCode } from './color/code';
import { parentPort, workerData } from 'node:worker_threads';
import { decodeImage, decodePixels, ImagePixels } from './image/decode';
import { NativeImageDecoder } from './platform/contracts';
import { extractRepresentativeColors } from './color/extraction';
import { PipelineInput } from './model';
import { generateVariant, generateVariants } from './variants';

if (parentPort) {
    const port = parentPort;
    const input = workerData as PipelineInput;
    // The parent owns the native subprocess. Transfer a dedicated ArrayBuffer so pooled
    // Buffer backing stores cannot accidentally include unrelated bytes.
    const convertNative: NativeImageDecoder = bytes => new Promise((resolve, reject) => {
        port.once('message', (message: { png?: Uint8Array; error?: string }) => {
            if (message.error) { reject(new Error(message.error)); }
            else if (message.png instanceof Uint8Array) { resolve(message.png); }
            else { reject(new Error('Invalid native decoder reply')); }
        });
        const source = Uint8Array.from(bytes);
        port.postMessage({ nativeDecode: source }, [source.buffer]);
    });
    void (async () => {
        try {
            // Structured cloning carries plain strings, not a runtime brand. Validate supplied
            // colors before allowing reused previews into conversion/contrast calculations.
            let swatches = input.swatches?.map(swatch => ({ ...swatch, hex: parseHexColorCode(swatch.hex) }));
            if (!swatches) {
                if (!input.path) { throw new Error('No wallpaper source'); }
                const image = input.nativeFileDecode
                    ? await new Promise<ImagePixels>((resolve, reject) => {
                        port.once('message', (message: { png?: Uint8Array; error?: string }) => {
                            if (message.error) { reject(new Error(message.error)); }
                            else if (message.png instanceof Uint8Array) {
                                try { resolve(decodePixels(message.png)); } catch (error) { reject(error); }
                            } else { reject(new Error('Invalid native decoder reply')); }
                        });
                        port.postMessage({ nativeDecodePath: input.path });
                    })
                    : await decodeImage(input.path, convertNative);
                swatches = extractRepresentativeColors(image.data, image.width, image.height);
            }
            port.postMessage({ result: input.previews ? generateVariants(swatches, input.primaries, input.syntaxStyle, input.borderContrast) : generateVariant(swatches, input.harmony!, input.appearance!, input.primary, input.syntaxStyle, input.borderContrast) });
        } catch (error) { port.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
        finally { port.close(); }
    })();
}
