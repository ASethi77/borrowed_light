import { desktopInteropScript } from '../../platform/windows/scripts';
import { wallpaperScript as macosWallpaperScript } from '../../platform/macos/scripts';
import { osascriptArguments } from '../../platform/macos/wallpaper';
import { test, mock } from 'node:test';
import { runInNewContext } from 'node:vm';
import fs = require('node:fs');
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { detectPlatform } from '../../platform/os_detect';
import { providerRegistry, selectProvider, nativeImageDecoder } from '../../platform/os_wallpaper';
import { WindowsProvider, primaryWallpaperPath, powershellArguments, powershellExecutable } from '../../platform/windows/wallpaper';
import { MacosProvider, selectedWallpaperUri } from '../../platform/macos/wallpaper';
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
    assert.equal(Buffer.from(await windowsImageDecoder(run)(source, abort.signal)).toString(), 'normalized');
});
test('macOS normalizes a bounded thumbnail from a literal file path and cleans temporary files', async () => {
    const source = resolve('src/test/fixtures/green.heic');
    const signal = new AbortController().signal;
    let normalized = '';
    const decoder = macosImageDecoder(async (executable, args, options) => {
        assert.equal(executable, '/usr/bin/sips');
        if (args[0] === '-g') { return Buffer.from('pixelWidth: 8000\npixelHeight: 6000'); }
        assert.equal(args[1], '1024');
        assert.equal(args[5], source);
        assert.equal(options?.signal, signal);
        normalized = args.at(-1)!;
        await writeFile(normalized, 'thumbnail');
        return Buffer.alloc(0);
    });
    assert.equal(Buffer.from(await decoder.fromFile!(source, signal)).toString(), 'thumbnail');
    await assert.rejects(readFile(normalized), /ENOENT/);
});
test('macOS uses the selected image or local aerial thumbnail instead of a stale API fallback', async () => {
    const fallback = wallpaperUri('/System/Library/CoreServices/DefaultDesktop.heic');
    const selected = wallpaperUri('/tmp/tree.heic');
    assert.equal(await selectedWallpaperUri({ provider: 'com.apple.wallpaper.choice.image', configuration: { url: { relative: selected } } }, fallback), selected);
    assert.equal(await selectedWallpaperUri({ provider: 'com.apple.wallpaper.choice.image', files: [{ relative: selected }] }, fallback), selected);
    const id = '6D6834A4-2F0F-479A-B053-7D4DC5CB8EB7';
    const aerial = { provider: 'com.apple.wallpaper.choice.aerials', configuration: { assetID: id } };
    const uri = await selectedWallpaperUri(aerial, fallback, '/tmp/home', async path => { assert.ok(path.endsWith(id + '.png')); });
    assert.ok(wallpaperPath(uri).endsWith(id + '.png'));
    await assert.rejects(selectedWallpaperUri(aerial, fallback, '/tmp/home', async () => { throw new Error('missing'); }), /No local preview/);
    await assert.rejects(selectedWallpaperUri({ ...aerial, configuration: { assetID: '../escape' } }, fallback), /identifier/);
    assert.equal(await selectedWallpaperUri(null, fallback), fallback);
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

test('Windows COM discovery skips detached, failing and non-primary displays', { skip: process.platform !== 'win32' }, async () => {
    const fake = `public class FakeDesktop : IDesktopWallpaper {
        public void SetWallpaper(string monitor, string wallpaper) { }
        public string GetWallpaper(string monitor) {
            if (monitor != "3") throw new Exception("Queried non-primary wallpaper");
            return "primary.png";
        }
        public string GetMonitorDevicePathAt(uint index) { return index.ToString(); }
        public uint GetMonitorDevicePathCount() { return 5; }
        public int GetMonitorRECT(string monitor, out Rectangle rectangle) {
            rectangle = new Rectangle { Left = 0, Top = 0, Right = 1920, Bottom = 1080 };
            if (monitor == "0") return 1; // S_FALSE, even with misleading bounds
            if (monitor == "1") return unchecked((int)0x80004005); // observed E_FAIL
            if (monitor == "2") rectangle.Left = -1920;
            if (monitor == "4") throw new Exception("Continued past primary");
            return 0;
        }
    }
    public static class Desktop`;
    const script = desktopInteropScript.replace('public static class Desktop', fake) + `
        $primary = New-Object BorrowedLight.Rectangle
        $primary.Right = 1920; $primary.Bottom = 1080
        $snapshot = [BorrowedLight.Desktop]::Collect((New-Object BorrowedLight.FakeDesktop), $primary)
        [Console]::Write(($snapshot | ConvertTo-Json -Depth 6 -Compress))`;
    const snapshot = JSON.parse((await runProcess(powershellExecutable(), powershellArguments(script))).toString('utf8'));
    assert.equal(snapshot.Monitors.length, 1);
    assert.equal(snapshot.Monitors[0].Path, 'primary.png');
});

test('Windows file decoding bounds large JPEG thumbnails before the palette worker', { skip: process.platform !== 'win32' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'borrowed-light-thumbnail-'));
    const path = join(directory, 'wallpaper é #.jpg');
    try {
        const jpeg = await import('jpeg-js');
        const data = Buffer.alloc(2048 * 1024 * 4);
        for (let offset = 0; offset < data.length; offset += 4) { data.set([34, 153, 68, 255], offset); }
        await writeFile(path, jpeg.encode({ data, width: 2048, height: 1024 }, 80).data);
        const pixels = decodePixels(await windowsImageDecoder().fromFile!(path, new AbortController().signal));
        assert.equal(pixels.width, 1024);
        assert.equal(pixels.height, 512);
        for (const [channel, expected] of [34, 153, 68, 255].entries()) { assert.ok(Math.abs(pixels.data[channel] - expected) <= 5); }
    } finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
});

test('macOS reads the desktop appearance preference rather than the helper app appearance', () => {
    for (const [preference, expected] of [['Dark', 'dark'], [undefined, 'light']]) {
        const context = {
            ObjC: { import: () => {}, unwrap: (value: unknown) => value },
            $: {
                NSScreen: { screens: { count: 1, objectAtIndex: () => ({}) } },
                NSWorkspace: { sharedWorkspace: { desktopImageURLForScreen: () => ({ absoluteString: wallpaperUri(path), isNil: () => false }) } },
                NSUserDefaults: { standardUserDefaults: { stringForKey: () => preference } },
                NSDictionary: { dictionaryWithContentsOfFile: () => null },
                NSHomeDirectory: () => '/tmp/home',
            },
        };
        const value = JSON.parse(runInNewContext(macosWallpaperScript + '\nrun();', context));
        assert.equal(value.appearance, expected);
    }
});
test('macOS watches store replacement, polls appearance, and stops notifications on disposal', context => {
    const watcher = Object.assign(new EventEmitter(), { closed: false, close() { this.closed = true; } });
    let notify!: () => void;
    const replacement = mock.method(fs, 'watch', (_directory: string, callback: () => void) => { notify = callback; return watcher; });
    context.mock.timers.enable({ apis: ['setInterval'] });
    let changed = 0, failed = 0;
    try {
        const monitor = new MacosProvider().watch(() => changed++, () => failed++);
        notify(); assert.equal(changed, 1);
        context.mock.timers.tick(5000); assert.equal(changed, 2);
        watcher.emit('error', new Error('watch failed')); assert.equal(failed, 1);
        monitor.dispose(); assert.ok(watcher.closed);
        notify(); context.mock.timers.tick(10000); assert.equal(changed, 2);
    } finally { context.mock.timers.reset(); replacement.mock.restore(); }
});
