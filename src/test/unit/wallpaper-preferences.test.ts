import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WallpaperPrimaries } from '../../wallpaper_preferences';
import { PrimaryChoices } from '../../model';

class Memory {
    private readonly values = new Map<string, unknown>();
    get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
    async update(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
}
const custom: PrimaryChoices = { light: 'wallpaper-2', dark: 'harmony-3' };
const automatic: PrimaryChoices = { light: 'automatic', dark: 'automatic' };

test('primary choices survive repeated syncs and restart for the same wallpaper', async () => {
    const state = new Memory(), preferences = new WallpaperPrimaries(state);
    assert.deepEqual(preferences.resolve('wallpaper-A', custom), { primaries: custom, reset: false });
    await preferences.remember('wallpaper-A');
    assert.deepEqual(new WallpaperPrimaries(state).resolve('wallpaper-A', custom), { primaries: custom, reset: false });
});
test('a new or replaced wallpaper resets both appearances until new choices are accepted', async () => {
    const preferences = new WallpaperPrimaries(new Memory());
    await preferences.remember('wallpaper-A');
    assert.deepEqual(preferences.resolve('wallpaper-B', custom), { primaries: automatic, reset: true });
    // A report, failed sync or cancelled preview merely reads the new wallpaper.
    assert.equal(preferences.resolve('wallpaper-B', custom).reset, true);
    assert.equal(preferences.resolve('wallpaper-A', custom).reset, false);
    await preferences.remember('wallpaper-B');
    assert.deepEqual(preferences.resolve('wallpaper-B', custom), { primaries: custom, reset: false });
    assert.deepEqual(preferences.resolve('wallpaper-B-new-metadata', custom), { primaries: automatic, reset: true });
});
