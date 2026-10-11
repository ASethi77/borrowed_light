import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, mock } from 'node:test';
import childProcess = require('node:child_process');
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import assert from 'node:assert/strict';
import { GnomeProvider } from '../../platform/linux/gnome/wallpaper';
import { parseGvariant } from '../../platform/linux/gnome/gsettings';
import { selectProvider } from '../../platform/os_wallpaper';
import { detectPlatform } from '../../platform/os_detect';
import { wallpaperPath, wallpaperUri } from '../../image/source';

test('GVariant and file URI parsing handle quoted paths, Unicode, and percent escapes', () => {
    assert.equal(parseGvariant("'file:///tmp/a%20b%20%C3%A9.png'"), 'file:///tmp/a%20b%20%C3%A9.png');
    assert.equal(parseGvariant("'it\\'s \\u00e9.png'"), "it's é.png");
    const nativePath = process.platform === 'win32' ? 'C:\\tmp\\a b é.png' : '/tmp/a b é.png';
    assert.equal(wallpaperPath(wallpaperUri(nativePath)), nativePath);
    assert.throws(() => parseGvariant('$(touch /tmp/file)'), /Invalid/);
    assert.throws(() => parseGvariant("'bad\\q'"), /escape/);
    assert.throws(() => parseGvariant("'bad\\'"), /escape/);
    assert.throws(() => parseGvariant("'bad'quote'"), /quote/);
    assert.throws(() => wallpaperPath('https://example.com/wallpaper.png'), /local/);
});
test('GNOME chooses actual desktop appearance and falls back on older/empty dark settings', async () => {
    const darkUri = wallpaperUri(join(tmpdir(), 'dark.png')), lightUri = wallpaperUri(join(tmpdir(), 'light.png'));
    for (const dark of [`'${darkUri}'`, "''", 'missing']) {
        const provider = new GnomeProvider(async args => {
            const key = args.at(-1);
            if (key === 'color-scheme') { return "'prefer-dark'"; }
            if (key === 'picture-uri-dark') { if (dark === 'missing') { throw new Error('missing'); } return dark; }
            return `'${lightUri}'`;
        });
        const current = await provider.current();
        assert.equal(current.appearance, 'dark');
        assert.equal(current.uri, dark.includes('dark.png') ? darkUri : lightUri);
    }
    const light = new GnomeProvider(async args => args.at(-1) === 'color-scheme' ? "'default'" : `'${lightUri}'`);
    assert.equal((await light.current()).uri, lightUri);
});
test('schema availability and unsupported platforms fail clearly', async () => {
    assert.equal(await new GnomeProvider(async () => 'org.gnome.desktop.background\norg.gnome.desktop.interface').available(), true);
    assert.equal(await new GnomeProvider(async () => { throw new Error('missing executable'); }).available(), false);
    for (const platform of ['freebsd', 'aix']) {
        const provider = await selectProvider(detectPlatform(platform, { XDG_CURRENT_DESKTOP: 'GNOME' }));
        await assert.rejects(provider.current(), /No wallpaper provider/);
    }
});
test('GNOME monitoring dispatches notifications and stops all children on disposal', () => {
    const children: (EventEmitter & { stdout: PassThrough; kills: number; kill(): boolean })[] = [];
    const replacement = mock.method(childProcess, 'spawn', () => {
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kills: 0, kill() { this.kills++; return true; } });
        children.push(child);
        return child as unknown as childProcess.ChildProcess;
    });
    try {
        let changed = 0, failed = 0;
        const watching = new GnomeProvider().watch(() => changed++, () => failed++);
        assert.equal(children.length, 2);
        children[0].stdout.emit('data', Buffer.from("picture-uri: 'file:///new.png'"));
        children[1].stdout.emit('data', Buffer.from("color-scheme: 'prefer-dark'"));
        assert.equal(changed, 2);
        children[0].emit('error', new Error('monitor failure'));
        assert.equal(failed, 1);
        watching.dispose();
        children.forEach(child => { assert.equal(child.kills, 1); child.stdout.emit('data', 'late'); child.emit('exit', 0); });
        assert.equal(changed, 2); assert.equal(failed, 1);
    } finally { replacement.mock.restore(); }
});
