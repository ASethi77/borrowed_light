import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import childProcess = require('node:child_process');
import fs = require('node:fs');
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { watchWindowsWallpaper } from '../../platform/windows/watcher';
import { WindowsProvider, powershellArguments, powershellExecutable } from '../../platform/windows/wallpaper';
import { wallpaperWatchScript } from '../../platform/windows/scripts';
import { runProcess } from '../../platform/process';

test('Windows event monitor handles split lines, cache updates, failures and disposal', context => {
    const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        kills: 0, kill() { this.kills++; return true; },
    });
    const cache = Object.assign(new EventEmitter(), { closed: false, close() { this.closed = true; } });
    let cacheChanged!: (event: string, filename: string) => void;
    const spawn = mock.method(childProcess, 'spawn', (_exe: string, args: string[], options: childProcess.SpawnOptions) => {
        assert.equal(options.windowsHide, true);
        assert.equal(Buffer.from(args.at(-1)!, 'base64').toString('utf16le'), wallpaperWatchScript);
        return child as unknown as childProcess.ChildProcess;
    });
    const watch = mock.method(fs, 'watch', (_path: string, options: fs.WatchOptions, callback: typeof cacheChanged) => {
        assert.equal(options.recursive, true);
        cacheChanged = callback;
        return cache;
    });
    context.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        let changed = 0, failed = 0;
        const monitor = watchWindowsWallpaper(() => changed++, () => failed++);
        child.stdout.emit('data', 'rea');
        child.stdout.emit('data', 'dy\r\nchanged\nchan');
        child.stdout.emit('data', 'ged\n');
        assert.equal(changed, 3);
        cacheChanged('rename', 'CachedFiles\\CachedImage.jpg');
        cacheChanged('change', 'TranscodedWallpaper');
        cacheChanged('change', 'unrelated.txt');
        assert.equal(changed, 5);
        context.mock.timers.tick(10000);
        assert.equal(child.kills, 0, 'ready cancels startup timeout');
        child.emit('error', new Error('failed'));
        child.emit('close', 1);
        assert.equal(failed, 1, 'failure reported once');
        monitor.dispose(); monitor.dispose();
        assert.ok(cache.closed);
        assert.equal(child.kills, 1);
        child.stdout.emit('data', 'changed\n'); cacheChanged('change', 'TranscodedWallpaper');
        child.emit('close', 0);
        assert.equal(changed, 5); assert.equal(failed, 1);
        assert.equal(new WindowsProvider().pollIntervalMs, 300000);
    } finally { context.mock.timers.reset(); spawn.mock.restore(); watch.mock.restore(); }
});

test('Windows registry helper receives repeated native events and exits on stdin EOF', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
    // Exercise the real Win32 API on an isolated key without changing desktop settings.
    const key = `Software\\BorrowedLightTests\\${randomUUID()}`;
    const literal = `HKCU:\\${key}`;
    const run = (script: string) => runProcess(powershellExecutable(), powershellArguments(script));
    await run(`New-Item -Path '${literal}\\Desktop', '${literal}\\Themes' -Force | Out-Null`);
    const script = wallpaperWatchScript
        .replace('Control Panel\\Desktop', key + '\\Desktop')
        .replace('Software\\Microsoft\\Windows\\CurrentVersion\\Themes', key + '\\Themes');
    const child = childProcess.spawn(powershellExecutable(), powershellArguments(script), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = once(child, 'close');
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { errors += chunk.toString(); });
    const waitFor = async (expected: number) => {
        const deadline = Date.now() + 5000;
        while (output.trim().split('\n').length < expected || !output.includes('ready')) {
            assert.equal(child.exitCode, null, errors);
            assert.ok(Date.now() < deadline, `No registry notification: ${output} ${errors}`);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    };
    try {
        await waitFor(1);
        for (let index = 1; index <= 2; index++) {
            await run(`Set-ItemProperty -LiteralPath '${literal}\\${index === 1 ? 'Desktop' : 'Themes'}' -Name TestValue -Value ${index}`);
            await waitFor(index + 1);
        }
        child.stdin.end();
        const [code] = await closed;
        assert.equal(code, 0, errors);
        assert.ok(output.includes('changed'));
    } finally {
        child.kill();
        await run(`Remove-Item -LiteralPath '${literal}' -Recurse -Force`);
    }
});

test('Windows monitor startup timeout reports failure and kills the stalled helper', context => {
    const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        kills: 0, kill() { this.kills++; return true; },
    });
    const cache = Object.assign(new EventEmitter(), { close() { } });
    const spawn = mock.method(childProcess, 'spawn', () => child as unknown as childProcess.ChildProcess);
    const watch = mock.method(fs, 'watch', () => cache);
    context.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const failures: Error[] = [];
        const monitor = watchWindowsWallpaper(() => {}, error => failures.push(error));
        context.mock.timers.tick(10000);
        assert.equal(child.kills, 1);
        assert.match(failures[0].message, /did not start/);
        child.emit('close', 1);
        assert.equal(failures.length, 1);
        monitor.dispose();
    } finally { context.mock.timers.reset(); spawn.mock.restore(); watch.mock.restore(); }
});
