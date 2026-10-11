/** AppKit's first NSScreen is the primary/menu-bar display, unlike mainScreen which
 * follows keyboard focus. NSWorkspace is queried on osascript's main thread.
 * https://developer.apple.com/documentation/appkit/nsworkspace/desktopimageurl(for:)
 */
export const wallpaperScript = String.raw`
ObjC.import('AppKit');
function run() {
    const screens = $.NSScreen.screens;
    if (Number(screens.count) === 0) { throw new Error('No macOS desktop session is available'); }
    const screen = screens.objectAtIndex(0);
    const url = $.NSWorkspace.sharedWorkspace.desktopImageURLForScreen(screen);
    if (!url || url.isNil()) { throw new Error('macOS primary display has no wallpaper image configured'); }
    const appearance = $.NSApplication.sharedApplication.effectiveAppearance;
    const match = appearance.bestMatchFromAppearancesWithNames([$.NSAppearanceNameAqua, $.NSAppearanceNameDarkAqua]);
    return JSON.stringify({ uri: ObjC.unwrap(url.absoluteString), appearance: ObjC.unwrap(match) === 'NSAppearanceNameDarkAqua' ? 'dark' : 'light' });
}
`;

/** Read metadata with ImageIO before creating a raster. Multi-image files deliberately
 * use index 0. AppKit encodes that still image as PNG for the shared portable decoder.
 * https://developer.apple.com/documentation/imageio/cgimagesourcecopypropertiesatindex(_:_:_:)
 */
export const imageScript = String.raw`
ObjC.import('AppKit');
ObjC.import('ImageIO');
function run() {
    const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    if (Number(data.length) > 67108864) { throw new Error('Wallpaper exceeds the 64 MiB input limit'); }
    const source = $.CGImageSourceCreateWithData(data, null);
    if (!source) { throw new Error('macOS cannot decode this wallpaper format'); }
    // ImageIO returns an opaque CFDictionaryRef, not an Objective-C dictionary.
    // Bridge the toll-free Foundation object before unwrapping its numeric metadata.
    const propertiesRef = $.CGImageSourceCopyPropertiesAtIndex(source, 0, null);
    if (!propertiesRef) { throw new Error('macOS cannot read wallpaper dimensions'); }
    const properties = ObjC.deepUnwrap(ObjC.castRefToObject(propertiesRef));
    const width = Number(properties.PixelWidth), height = Number(properties.PixelHeight);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) { throw new Error('macOS returned invalid wallpaper dimensions'); }
    if (width * height > 32000000) { throw new Error('Wallpaper exceeds the 32 megapixel limit'); }
    const image = $.CGImageSourceCreateImageAtIndex(source, 0, null);
    if (!image) { throw new Error('macOS cannot decode this wallpaper frame'); }
    const representation = $.NSBitmapImageRep.alloc.initWithCGImage(image);
    const png = representation.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary);
    if (!png || png.isNil()) { throw new Error('macOS could not normalize the wallpaper'); }
    if (Number(png.length) > 67108864) { throw new Error('Normalized wallpaper exceeds the 64 MiB output limit'); }
    $.NSFileHandle.fileHandleWithStandardOutput.writeData(png);
}
`;
