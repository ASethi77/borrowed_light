import { test, mock } from 'node:test';
import childProcess = require('node:child_process');
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import assert from 'node:assert/strict';
import { GnomeProvider, parseGvariant, selectProvider, wallpaperPath } from '../../providers';

test('GVariant and file URI parsing handle quoted paths, Unicode, and percent escapes', () => {
    assert.equal(parseGvariant("'file:///tmp/a%20b%20%C3%A9.png'"), 'file:///tmp/a%20b%20%C3%A9.png');
    assert.equal(parseGvariant("'it\\'s \\u00e9.png'"), "it's é.png");
    assert.equal(wallpaperPath('file:///tmp/a%20b%20%C3%A9.png'), '/tmp/a b é.png');
    assert.throws(() => parseGvariant('$(touch /tmp/file)'), /Invalid/);
    assert.throws(() => parseGvariant("'bad\\q'"), /escape/);
    assert.throws(() => parseGvariant("'bad\\'"), /escape/);
    assert.throws(() => parseGvariant("'bad'quote'"), /quote/);
    assert.throws(() => wallpaperPath('https://example.com/wallpaper.png'), /local/);
});
test('GNOME chooses actual desktop appearance and falls back on older/empty dark settings', async () => {
    for (const dark of ["'file:///dark.png'", "''", 'missing']) {
        const provider = new GnomeProvider(async args => {
            const key = args.at(-1);
            if (key === 'color-scheme') { return "'prefer-dark'"; }
            if (key === 'picture-uri-dark') { if (dark === 'missing') { throw new Error('missing'); } return dark; }
            return "'file:///light.png'";
        });
        const current = await provider.current();
        assert.equal(current.appearance, 'dark');
        assert.equal(current.uri, dark.includes('dark.png') ? 'file:///dark.png' : 'file:///light.png');
    }
    const light = new GnomeProvider(async args => args.at(-1) === 'color-scheme' ? "'default'" : "'file:///light.png'");
    assert.equal((await light.current()).uri, 'file:///light.png');
});
test('schema availability and unsupported platforms fail clearly', async () => {
    assert.equal(await new GnomeProvider(async () => 'org.gnome.desktop.background\norg.gnome.desktop.interface').available(), true);
    assert.equal(await new GnomeProvider(async () => { throw new Error('missing executable'); }).available(), false);
    for (const platform of ['win32', 'darwin'] as NodeJS.Platform[]) {
        const provider = await selectProvider(platform, 'GNOME');
        await assert.rejects(provider.current(), /no wallpaper provider/);
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
