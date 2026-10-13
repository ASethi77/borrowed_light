import { NativeImageDecoder } from '../contracts';
import { ProcessRunner, runProcess } from '../process';
import { maxBytes } from '../../image/limits';
import { readImageBytes } from '../../image/decode';
import { imageScript } from './scripts';
import { powershellArguments, powershellExecutable } from './wallpaper';

export function windowsImageDecoder(run: ProcessRunner = runProcess): NativeImageDecoder {
    const decoder: NativeImageDecoder = (bytes, signal) => run(powershellExecutable(), powershellArguments(imageScript), { input: bytes, signal, timeoutMs: 15000, maxOutputBytes: maxBytes });
    // Decode outside the constrained JS worker, including JPEG/PNG wallpapers.
    decoder.fromFile = async (path, signal) => decoder(await readImageBytes(path), signal);
    return decoder;
}
