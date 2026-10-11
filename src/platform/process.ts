import { spawn } from 'node:child_process';

export interface ProcessOptions { input?: Uint8Array; signal?: AbortSignal; timeoutMs?: number; maxOutputBytes?: number }
export type ProcessRunner = (executable: string, args: string[], options?: ProcessOptions) => Promise<Buffer>;

/** Fixed commands + argument arrays, never a shell expression. Drain bounded stdout and
 * stderr; kill and reap on abort, timeout or output overflow before settling the promise.
 */
export const runProcess: ProcessRunner = (executable, args, options = {}) => new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('Platform helper cancelled')); return; }
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const output: Buffer[] = [], errors: Buffer[] = [];
    let outputBytes = 0, errorBytes = 0, failure: Error | undefined;
    const stop = (error: Error) => {
        if (!failure) { failure = error; child.kill('SIGKILL'); }
    };
    const abort = () => stop(new Error('Platform helper cancelled'));
    const timer = setTimeout(() => stop(new Error('Platform helper timed out')), options.timeoutMs ?? 5000);
    options.signal?.addEventListener('abort', abort, { once: true });
    // Close the narrow race between checking the signal and registering its listener.
    if (options.signal?.aborted) { abort(); }
    child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > (options.maxOutputBytes ?? 1024 * 1024)) { stop(new Error('Platform helper output exceeds its size limit')); }
        else { output.push(chunk); }
    });
    child.stderr.on('data', (chunk: Buffer) => {
        errorBytes += chunk.length;
        if (errorBytes > 64 * 1024) { stop(new Error('Platform helper error output exceeds its size limit')); }
        else { errors.push(chunk); }
    });
    child.on('error', error => { failure ??= error; });
    child.stdin.on('error', error => stop(error));
    child.on('close', code => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        if (failure) { reject(failure); }
        else if (code !== 0) { reject(new Error(`Platform helper failed (${code}): ${Buffer.concat(errors).toString('utf8').trim()}`)); }
        else { resolve(Buffer.concat(output)); }
    });
    child.stdin.end(options.input);
});
