import { NativeImageDecoder } from '../contracts';
import { ProcessRunner, runProcess } from '../process';
import { maxBytes } from '../../image/limits';
import { imageScript } from './scripts';
import { powershellArguments, powershellExecutable } from './wallpaper';

export function windowsImageDecoder(run: ProcessRunner = runProcess): NativeImageDecoder {
    return (bytes, signal) => run(powershellExecutable(), powershellArguments(imageScript), { input: bytes, signal, timeoutMs: 15000, maxOutputBytes: maxBytes });
}
