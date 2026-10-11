import { NativeImageDecoder } from '../contracts';
import { ProcessRunner, runProcess } from '../process';
import { maxBytes } from '../../image/limits';
import { imageScript } from './scripts';
import { osascriptArguments } from './wallpaper';

export function macosImageDecoder(run: ProcessRunner = runProcess): NativeImageDecoder {
    return (bytes, signal) => run('/usr/bin/osascript', osascriptArguments(imageScript), { input: bytes, signal, timeoutMs: 15000, maxOutputBytes: maxBytes });
}
