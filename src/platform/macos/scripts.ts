/** NSWorkspace may report DefaultDesktop.heic for Sonoma+ aerial wallpapers.
 * Read the selected display's wallpaper store as well; retain the API for older OSes.
 * The store is an undocumented local format, so return only fields we understand.
 */
export const wallpaperScript = String.raw`
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
function run() {
    const screens = $.NSScreen.screens;
    if (Number(screens.count) === 0) { throw new Error('No macOS desktop session is available'); }
    const screen = screens.objectAtIndex(0);
    const url = $.NSWorkspace.sharedWorkspace.desktopImageURLForScreen(screen);
    const appearance = ObjC.unwrap($.NSUserDefaults.standardUserDefaults.stringForKey('AppleInterfaceStyle')) === 'Dark' ? 'dark' : 'light';
    let selection = null;
    const store = $.NSDictionary.dictionaryWithContentsOfFile(ObjC.unwrap($.NSHomeDirectory()) + '/Library/Application Support/com.apple.wallpaper/Store/Index.plist');
    if (store && !store.isNil()) {
        const displayID = Number(ObjC.unwrap(screen.deviceDescription.objectForKey('NSScreenNumber')));
        const uuid = ObjC.unwrap(ObjC.castRefToObject($.CFUUIDCreateString(null, $.CGDisplayCreateUUIDFromDisplayID(displayID))));
        const displays = store.objectForKey('Displays');
        let selected = displays && !displays.isNil() ? displays.objectForKey(uuid) : null;
        if (!selected || selected.isNil()) { selected = store.objectForKey('AllSpacesAndDisplays'); }
        if (selected && !selected.isNil()) {
            const desktop = selected.objectForKey('Desktop');
            const content = desktop && !desktop.isNil() ? desktop.objectForKey('Content') : null;
            const choices = content && !content.isNil() ? content.objectForKey('Choices') : null;
            if (choices && !choices.isNil() && Number(choices.count) === 1) {
                const choice = choices.objectAtIndex(0);
                const data = choice.objectForKey('Configuration');
                let configuration = {};
                if (data && !data.isNil() && Number(data.length)) {
                    const decoded = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, 0, null, null);
                    if (decoded && !decoded.isNil()) { configuration = ObjC.deepUnwrap(decoded); }
                }
                const files = choice.objectForKey('Files');
                selection = { provider: ObjC.unwrap(choice.objectForKey('Provider')), configuration: configuration, files: files && !files.isNil() ? ObjC.deepUnwrap(files) : [] };
            }
        }
    }
    if ((!url || url.isNil()) && !selection) { throw new Error('macOS primary display has no wallpaper image configured'); }
    return JSON.stringify({ uri: url && !url.isNil() ? ObjC.unwrap(url.absoluteString) : null, appearance: appearance, selection: selection });
}
`;

/** Fresh preferences query, independent of the wallpaper store or desktop image. */
export const appearanceScript = String.raw`
ObjC.import('AppKit');
function run() {
    return ObjC.unwrap($.NSUserDefaults.standardUserDefaults.stringForKey('AppleInterfaceStyle')) === 'Dark' ? 'dark' : 'light';
}
`;
