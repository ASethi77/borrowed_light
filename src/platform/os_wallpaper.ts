import { NativeImageDecoder, Wallpaper, WallpaperProvider } from './contracts';
import { detectPlatform, PlatformDescription } from './os_detect';
import { GnomeProvider } from './linux/gnome/wallpaper';
import { WindowsProvider } from './windows/wallpaper';
import { MacosProvider } from './macos/wallpaper';
import { windowsImageDecoder } from './windows/image_decoder';
import { macosImageDecoder } from './macos/image_decoder';

export const providerChoices = ['auto', 'windows', 'macos', 'linux-gnome'] as const;
export type ProviderChoice = typeof providerChoices[number];
export function isProviderChoice(value: unknown): value is ProviderChoice { return providerChoices.includes(value as ProviderChoice); }
export class UnsupportedProvider implements WallpaperProvider {
    readonly id = 'unsupported';
    constructor(private readonly reason: string) {}
    async available(): Promise<boolean> { return true; }
    async current(): Promise<Wallpaper> { throw new Error(this.reason); }
    async appearance(): Promise<'light' | 'dark'> { throw new Error(this.reason); }
}
export interface ProviderRegistration {
    id: Exclude<ProviderChoice, 'auto'>;
    os: PlatformDescription['os'];
    matches(platform: PlatformDescription): boolean;
    create(): WallpaperProvider;
}
export const providerRegistry: readonly ProviderRegistration[] = [
    { id: 'windows', os: 'WINDOWS', matches: platform => platform.os === 'WINDOWS', create: () => new WindowsProvider() },
    { id: 'macos', os: 'MACOS', matches: platform => platform.os === 'MACOS', create: () => new MacosProvider() },
    { id: 'linux-gnome', os: 'LINUX', matches: platform => platform.os === 'LINUX' && platform.desktop === 'GNOME', create: () => new GnomeProvider() },
];
/** An override selects a provider within the host OS, not a simulated operating system. */
export async function selectProvider(platform = detectPlatform(), choice: unknown = 'auto', registry: readonly ProviderRegistration[] = providerRegistry): Promise<WallpaperProvider> {
    if (!isProviderChoice(choice)) { return new UnsupportedProvider(`Unknown wallpaper provider setting: ${String(choice)}`); }
    const registration = registry.find(candidate => choice === 'auto' ? candidate.matches(platform) : candidate.id === choice);
    if (registration && registration.os !== platform.os) { return new UnsupportedProvider(`Wallpaper provider ${choice} is incompatible with ${platform.os}`); }
    if (registration) {
        const provider = registration.create();
        if (await provider.available()) { return provider; }
        return new UnsupportedProvider(`Wallpaper provider ${registration.id} is unavailable. Check desktop settings access and built-in OS helper permissions.`);
    }
    return new UnsupportedProvider(`No wallpaper provider for ${platform.os}/${platform.desktop} (OS: ${platform.rawPlatform}, desktop: ${platform.rawDesktop || 'UNKNOWN'}). Supported providers: Windows, macOS, Linux/GNOME.`);
}
/** Native codecs depend on OS, not the selected Linux desktop/provider preference. */
export function nativeImageDecoder(platform = detectPlatform()): NativeImageDecoder | undefined {
    return platform.os === 'WINDOWS' ? windowsImageDecoder() : platform.os === 'MACOS' ? macosImageDecoder() : undefined;
}
