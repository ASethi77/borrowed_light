import { desktopInteropScript } from '../../platform/windows/scripts';
import { wallpaperScript as macosWallpaperScript, imageScript as macosImageScript } from '../../platform/macos/scripts';
import { osascriptArguments } from '../../platform/macos/wallpaper';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { detectPlatform } from '../../platform/os_detect';
import { providerRegistry, selectProvider, nativeImageDecoder } from '../../platform/os_wallpaper';
import { WindowsProvider, primaryWallpaperPath, powershellArguments, powershellExecutable } from '../../platform/windows/wallpaper';
import { MacosProvider } from '../../platform/macos/wallpaper';
import { windowsImageDecoder } from '../../platform/windows/image_decoder';
import { macosImageDecoder } from '../../platform/macos/image_decoder';
import { runProcess, ProcessRunner } from '../../platform/process';
import { wallpaperPath, wallpaperUri } from '../../image/source';
import { decodePixels } from '../../image/decode';
import { maxBytes } from '../../image/limits';

const primary = { Left: 0, Top: 0, Right: 1920, Bottom: 1080 };
const secondary = { Left: -1920, Top: 0, Right: 0, Bottom: 1080 };
const path = resolve(tmpdir(), 'wallpaper "quote" $ (é) #.png');
const snapshot = { primary, monitors: [{ bounds: secondary, path: 'secondary.png' }, { bounds: primary, path }], appearance: 'dark' };

test('detection distinguishes OS and desktop identities, precedence and UNKNOWN', () => {
    assert.equal(detectPlatform('win32', { XDG_CURRENT_DESKTOP: 'GNOME' }).os, 'WINDOWS');
    assert.equal(detectPlatform('darwin', {}).os, 'MACOS');
    for (const [value, expected] of [['ubuntu:GNOME', 'GNOME'], ['X-Cinnamon', 'CINNAMON'], ['KDE', 'KDE'], ['plasmawayland', 'KDE'], ['XFCE', 'XFCE'], ['MATE', 'MATE'], ['LXQt', 'LXQT'], ['LXDE', 'LXDE'], ['Budgie:GNOME', 'BUDGIE']] as const) {
        assert.equal(detectPlatform('linux', { XDG_CURRENT_DESKTOP: value }).desktop, expected);
    }
    assert.equal(detectPlatform('linux', { XDG_CURRENT_DESKTOP: 'Custom', DESKTOP_SESSION: 'gnome-xorg' }).desktop, 'GNOME');
    assert.equal(detectPlatform('linux', { XDG_CURRENT_DESKTOP: 'KDE', DESKTOP_SESSION: 'gnome' }).desktop, 'KDE');
    assert.equal(detectPlatform('linux', { XDG_CURRENT_DESKTOP: 'notgnome' }).desktop, 'UNKNOWN');
    assert.deepEqual(detectPlatform('freebsd', {}), { os: 'UNKNOWN', desktop: 'UNKNOWN', rawPlatform: 'freebsd', rawDesktop: '' });
});
test('registry routes supported OSes and valid overrides without invoking incompatible helpers', async () => {
    const registry = providerRegistry.map(entry => ({ ...entry, create: () => ({ id: entry.id, available: async () => true, current: async () => ({ uri: wallpaperUri(path), appearance: 'light' as const, provider: entry.id }) }) }));
    for (const [os, desktop, expected] of [['win32', '', 'windows'], ['darwin', '', 'macos'], ['linux', 'GNOME', 'linux-gnome']] as const) {
        assert.equal((await selectProvider(detectPlatform(os, { XDG_CURRENT_DESKTOP: desktop }), 'auto', registry)).id, expected);
    }
    const unknownLinux = detectPlatform('linux', {});
    assert.equal((await selectProvider(unknownLinux, 'linux-gnome', registry)).id, 'linux-gnome');
    await assert.rejects((await selectProvider(unknownLinux, 'windows', registry)).current(), /incompatible/);
    await assert.rejects((await selectProvider(unknownLinux, 'invalid', registry)).current(), /Unknown/);
    await assert.rejects((await selectProvider(unknownLinux, 'auto', registry)).current(), /LINUX\/UNKNOWN/);
    const unavailable = registry.map(entry => ({ ...entry, create: () => ({ ...entry.create(), available: async () => false }) }));
    await assert.rejects((await selectProvider(detectPlatform('win32', {}), 'auto', unavailable)).current(), /unavailable/);
    assert.equal(nativeImageDecoder(unknownLinux), undefined);
});
test('Windows picks the primary rectangle rather than enumeration order and reports missing images', async () => {
    assert.equal(primaryWallpaperPath(snapshot), path);
    assert.throws(() => primaryWallpaperPath({ ...snapshot, monitors: [] }), /matches/);
    assert.throws(() => primaryWallpaperPath({ ...snapshot, monitors: [{ bounds: primary, path: '' }] }), /solid colors/);
    assert.throws(() => primaryWallpaperPath({ ...snapshot, primary: null }), /Invalid/);
    const calls: string[][] = [];
    const run: ProcessRunner = async (_executable, args) => { calls.push(args); return Buffer.from(JSON.stringify(snapshot)); };
    const provider = new WindowsProvider(run);
    assert.equal((await provider.current()).uri, wallpaperUri(path));
    assert.equal((await provider.current()).appearance, 'dark');
    const script = Buffer.from(calls[0].at(-1)!, 'base64').toString('utf16le');
    assert.ok(script.includes('GetMonitorInfo'));
    assert.ok(!script.includes(path), 'source paths do not enter fixed script text');
    assert.ok(calls[0].includes('-NonInteractive'));
    assert.equal(await new WindowsProvider(async () => { throw new Error('blocked'); }).available(), false);
});
test('macOS validates local URI responses and keeps discovery scripts fixed', async () => {
    const calls: string[][] = [];
    const provider = new MacosProvider(async (_executable, args) => { calls.push(args); return Buffer.from(JSON.stringify({ uri: wallpaperUri(path), appearance: 'light' })); });
    assert.deepEqual(await provider.current(), { uri: wallpaperUri(path), appearance: 'light', provider: 'macos' });
    assert.ok(calls[0].at(-1)!.includes('screens.objectAtIndex(0)'));
    assert.ok(!calls[0].at(-1)!.includes(path));
    await assert.rejects(new MacosProvider(async () => Buffer.from('{"uri":"https://example.com/image","appearance":"light"}')).current(), /local/);
    await assert.rejects(new MacosProvider(async () => Buffer.from('{}')).current(), /Invalid/);
    assert.equal(await new MacosProvider(async () => { throw new Error('blocked'); }).available(), false);
});
test('file URI round trips handle native Unicode, quotes, hash and Windows UNC paths', () => {
    assert.equal(wallpaperPath(wallpaperUri(path)), path);
    if (process.platform === 'win32') {
        assert.equal(wallpaperPath('file:///C:/wallpapers/a%20%C3%A9.png'), 'C:\\wallpapers\\a é.png');
        assert.equal(wallpaperPath('file://server/share/a%20b.png'), '\\\\server\\share\\a b.png');
    } else { assert.throws(() => wallpaperPath('file://server/share/a.png')); }
});
test('helper process passes literal arguments and bounded stdin/stdout without a shell', async () => {
    const value = "' $() ` & é \"";
    const output = await runProcess(process.execPath, ['-e', "const fs=require('node:fs');fs.writeSync(1,Buffer.concat([Buffer.from(process.argv[1]),fs.readFileSync(0)]));", value], { input: Buffer.from('pixels') });
    assert.equal(output.toString(), value + 'pixels');
    await assert.rejects(runProcess(process.execPath, ['-e', "require('node:fs').writeSync(2,'failed');process.exit(42)" ]), /failed/);
    await assert.rejects(runProcess(join(tmpdir(), 'nonexistent-borrowed-light-helper'), []), /ENOENT/);
    await assert.rejects(runProcess(process.execPath, ['-e', "require('node:fs').writeSync(1,'too much output')"], { maxOutputBytes: 2 }), /size limit/);
    await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 }), /timed out/);
});
test('abort kills and reaps the helper rather than leaving a subprocess alive', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-helper-'));
    const pidFile = join(directory, 'pid');
    const abort = new AbortController();
    const pending = runProcess(process.execPath, ['-e', "require('node:fs').writeFileSync(process.argv[1], String(process.pid));setInterval(() => {}, 1000);", pidFile], { signal: abort.signal });
    // Register rejection immediately; abort can reject before the next awaited operation.
    const stopped = assert.rejects(pending, /cancelled/);
    let pid = 0;
    for (let attempt = 0; attempt < 100 && !pid; attempt++) {
        try { pid = Number(await readFile(pidFile, 'utf8')); } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    assert.ok(pid, 'child starts');
    abort.abort(); await stopped;
    assert.throws(() => process.kill(pid, 0), /ESRCH|no such process/i);
});
test('native adapters send bytes via stdin with limits and cancellation', async () => {
    const abort = new AbortController();
    const source = Buffer.from('native image');
    const run: ProcessRunner = async (_executable, _args, options) => {
        assert.equal(options?.input, source);
        assert.equal(options?.signal, abort.signal);
        assert.equal(options?.maxOutputBytes, maxBytes);
        assert.equal(options?.timeoutMs, 15000);
        return Buffer.from('normalized');
    };
    for (const decoder of [windowsImageDecoder(run), macosImageDecoder(run)]) { assert.equal(Buffer.from(await decoder(source, abort.signal)).toString(), 'normalized'); }
});
test('macOS bridges opaque ImageIO metadata before validating dimensions and decoding', () => {
    const propertiesRef = Symbol('CFDictionaryRef');
    const dictionary = Symbol('NSDictionary');
    const png = { length: 82, isNil: () => false };
    const source = Symbol('CGImageSourceRef');
    let dimensions: Record<string, number | undefined> = { PixelWidth: 16, PixelHeight: 16 };
    let decoded = false, written = false;
    const context = {
        ObjC: {
            import: () => {},
            castRefToObject: (reference: unknown) => { assert.equal(reference, propertiesRef); return dictionary; },
            deepUnwrap: (object: unknown) => { assert.equal(object, dictionary, 'unwrap requires the bridged dictionary'); return dimensions; },
        },
        $: {
            NSFileHandle: {
                fileHandleWithStandardInput: { readDataToEndOfFile: { length: 441 } },
                fileHandleWithStandardOutput: { writeData: (bytes: unknown) => { assert.equal(bytes, png); written = true; } },
            },
            CGImageSourceCreateWithData: () => source,
            CGImageSourceCopyPropertiesAtIndex: (imageSource: unknown, index: number) => { assert.equal(imageSource, source); assert.equal(index, 0); return propertiesRef; },
            CGImageSourceCreateImageAtIndex: () => { decoded = true; return Symbol('CGImageRef'); },
            NSBitmapImageRep: { alloc: { initWithCGImage: () => ({ representationUsingTypeProperties: () => png }) } },
            NSBitmapImageFileTypePNG: 4,
            NSDictionary: { dictionary: {} },
        },
    };
    const run = () => runInNewContext(macosImageScript + '\nrun();', context);
    run(); assert.ok(decoded && written);
    for (const invalid of [{ PixelWidth: 10000000, PixelHeight: 16 }, { PixelWidth: 0, PixelHeight: 16 }, { PixelWidth: 1.5, PixelHeight: 16 }, {}]) {
        dimensions = invalid;
        decoded = false; written = false;
        assert.throws(run, /32 megapixel|invalid wallpaper dimensions/);
        assert.equal(decoded, false, 'reject invalid metadata before allocating the raster');
        assert.equal(written, false);
    }
});
test('real Windows BMP / macOS HEIC native decoding and malformed input', { skip: !['win32', 'darwin'].includes(process.platform) }, async () => {
    const decoder = nativeImageDecoder()!;
    const extension = process.platform === 'win32' ? 'bmp' : 'heic';
    const bytes = await readFile(resolve(`src/test/fixtures/green.${extension}`));
    const signal = new AbortController().signal;
    const pixels = decodePixels(await decoder(bytes, signal));
    assert.equal(pixels.width, 16); assert.equal(pixels.height, 16);
    for (const [channel, expected] of [34, 153, 68, 255].entries()) { assert.ok(Math.abs(pixels.data[channel] - expected) <= 5, `channel ${channel}`); }
    await assert.rejects(decoder(Buffer.from('not an image'), signal));
    // Huge BMP dimensions test preflight without allocating a huge pixel raster.
    if (process.platform === 'win32') {
        const huge = Buffer.from(bytes); huge.writeInt32LE(10000000, 18);
        await assert.rejects(decoder(huge, signal));
    }
});

test('native discovery helper compiles without requiring a configured desktop', { skip: !['win32', 'darwin'].includes(process.platform) }, async () => {
    const output = process.platform === 'win32'
        ? await runProcess(powershellExecutable(), powershellArguments(desktopInteropScript + "\n[Console]::Write('ready')"))
        : await runProcess('/usr/bin/osascript', osascriptArguments(macosWallpaperScript + "\nfunction run() { return 'ready'; }"));
    assert.equal(output.toString('utf8').trim(), 'ready');
});
