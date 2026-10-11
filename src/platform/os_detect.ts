export type OperatingSystem = 'WINDOWS' | 'MACOS' | 'LINUX' | 'UNKNOWN';
export type DesktopEnvironment = 'GNOME' | 'KDE' | 'CINNAMON' | 'XFCE' | 'MATE' | 'LXQT' | 'LXDE' | 'BUDGIE' | 'UNKNOWN';
export interface PlatformDescription {
    os: OperatingSystem;
    desktop: DesktopEnvironment;
    rawPlatform: string;
    rawDesktop: string;
}
const desktopAliases: Record<string, DesktopEnvironment> = {
    gnome: 'GNOME', 'gnome-classic': 'GNOME', 'gnome-xorg': 'GNOME', 'gnome-wayland': 'GNOME', ubuntu: 'GNOME',
    kde: 'KDE', plasma: 'KDE', plasmax11: 'KDE', plasmawayland: 'KDE',
    cinnamon: 'CINNAMON', 'x-cinnamon': 'CINNAMON', xfce: 'XFCE', xfce4: 'XFCE',
    mate: 'MATE', lxqt: 'LXQT', lxde: 'LXDE', budgie: 'BUDGIE', 'budgie-desktop': 'BUDGIE',
};
/** Session variables describe the user's desktop, not the shell running VS Code.
 * XDG_CURRENT_DESKTOP may contain colon-separated names (e.g. ubuntu:GNOME).
 * Prefer explicit identities over distribution aliases, then consult DESKTOP_SESSION.
 */
export function detectPlatform(rawPlatform: string = process.platform, environment: NodeJS.ProcessEnv = process.env): PlatformDescription {
    const os: OperatingSystem = rawPlatform === 'win32' ? 'WINDOWS' : rawPlatform === 'darwin' ? 'MACOS' : rawPlatform === 'linux' ? 'LINUX' : 'UNKNOWN';
    const rawDesktop = environment.XDG_CURRENT_DESKTOP || environment.DESKTOP_SESSION || '';
    let desktop: DesktopEnvironment = 'UNKNOWN';
    if (os === 'LINUX') {
        for (const value of [environment.XDG_CURRENT_DESKTOP, environment.DESKTOP_SESSION]) {
            const tokens = (value ?? '').toLowerCase().split(':').map(token => token.trim());
            const match = tokens.find(token => token !== 'ubuntu' && token in desktopAliases) ?? tokens.find(token => token in desktopAliases);
            if (match) { desktop = desktopAliases[match]; break; }
        }
    }
    return { os, desktop, rawPlatform, rawDesktop };
}
