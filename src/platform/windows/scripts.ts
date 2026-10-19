/** Built-in Windows PowerShell hosts the Win32 COM bridge; no installed SDK is needed.
 * IDesktopWallpaper: https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-idesktopwallpaper
 * Match GetMonitorRECT to the primary Win32 monitor rather than assuming monitor index 0.
 */
export const desktopInteropScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace BorrowedLight {
    [StructLayout(LayoutKind.Sequential)] public struct Rectangle { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int Size; public Rectangle Monitor, Work; public uint Flags; }
    [ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IDesktopWallpaper {
        void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitor, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
        [return: MarshalAs(UnmanagedType.LPWStr)] string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitor);
        [return: MarshalAs(UnmanagedType.LPWStr)] string GetMonitorDevicePathAt(uint index);
        uint GetMonitorDevicePathCount();
        [PreserveSig] int GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitor, out Rectangle rectangle);
    }
    public class MonitorWallpaper { public Rectangle Bounds; public string Path; }
    public class WallpaperSnapshot { public Rectangle Primary; public MonitorWallpaper[] Monitors; }
    public static class Desktop {
        [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point point, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
        [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        public static WallpaperSnapshot Snapshot() {
            // Compare physical monitor rectangles even when displays use different scaling.
            // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE = -3; restore this thread afterwards.
            IntPtr previousContext = SetThreadDpiAwarenessContext(new IntPtr(-3));
            if (previousContext == IntPtr.Zero) throw new Exception("Cannot query physical display coordinates");
            try { return PhysicalSnapshot(); }
            finally { SetThreadDpiAwarenessContext(previousContext); }
        }
        static WallpaperSnapshot PhysicalSnapshot() {
            var primary = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
            if (!GetMonitorInfo(MonitorFromPoint(new Point(), 1), ref primary)) throw new Exception("Cannot identify primary display");
            var desktop = (IDesktopWallpaper)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD")));
            try {
                return Collect(desktop, primary.Monitor);
            } finally { Marshal.FinalReleaseComObject(desktop); }
        }
        public static WallpaperSnapshot Collect(IDesktopWallpaper desktop, Rectangle primary) {
            var monitors = new System.Collections.Generic.List<MonitorWallpaper>();
            for (uint index = 0; index < desktop.GetMonitorDevicePathCount(); index++) {
                string monitor = desktop.GetMonitorDevicePathAt(index);
                Rectangle rectangle;
                // Enumeration includes detached/stale displays. S_FALSE and failures
                // have no usable rectangle and must not abort the primary lookup.
                if (desktop.GetMonitorRECT(monitor, out rectangle) != 0) continue;
                if (rectangle.Right <= rectangle.Left || rectangle.Bottom <= rectangle.Top) continue;
                if (rectangle.Left != primary.Left || rectangle.Top != primary.Top ||
                    rectangle.Right != primary.Right || rectangle.Bottom != primary.Bottom) continue;
                monitors.Add(new MonitorWallpaper { Bounds = rectangle, Path = desktop.GetWallpaper(monitor) });
                break;
            }
            return new WallpaperSnapshot { Primary = primary, Monitors = monitors.ToArray() };
        }
    }
}
'@
`;
export const wallpaperScript = String.raw`${desktopInteropScript}
try {
$snapshot = [BorrowedLight.Desktop]::Snapshot()
$theme = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction SilentlyContinue
$appearance = if ($null -ne $theme -and $theme.SystemUsesLightTheme -eq 0) { 'dark' } else { 'light' }
[Console]::WriteLine((@{ primary = $snapshot.Primary; monitors = @($snapshot.Monitors | ForEach-Object { @{ bounds = $_.Bounds; path = $_.Path } }); appearance = $appearance } | ConvertTo-Json -Depth 6 -Compress))
} catch { [Console]::Error.WriteLine($_.Exception.GetBaseException().Message); exit 1 }
`;

/** RegNotifyChangeKeyValue is one-shot: rearm before emitting each notification.
 * Waiting on events costs no polling work. Stdin EOF ends the helper if its owner exits.
 * https://learn.microsoft.com/windows/win32/api/winreg/nf-winreg-regnotifychangekeyvalue
 */
export const wallpaperWatchScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
namespace BorrowedLight {
    public static class RegistryMonitor {
        [DllImport("advapi32.dll")]
        static extern int RegNotifyChangeKeyValue(SafeRegistryHandle key, bool subtree,
            uint filter, SafeWaitHandle signal, bool asynchronous);
        static void Arm(RegistryKey key, EventWaitHandle signal) {
            // Watch subtree names and value changes, independent of issuing thread lifetime.
            int result = RegNotifyChangeKeyValue(key.Handle, true, 0x10000005, signal.SafeWaitHandle, true);
            if (result != 0) throw new Win32Exception(result);
        }
        public static void Run() {
            using (var desktop = Registry.CurrentUser.OpenSubKey(@"Control Panel\Desktop"))
            using (var themes = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes"))
            using (var desktopEvent = new AutoResetEvent(false))
            using (var themeEvent = new AutoResetEvent(false))
            using (var stopped = new ManualResetEvent(false)) {
                if (desktop == null || themes == null) throw new Exception("Windows wallpaper registry keys are unavailable");
                var reader = new Thread(() => {
                    try { var input = Console.OpenStandardInput(); while (input.ReadByte() != -1) { } }
                    finally { stopped.Set(); }
                });
                reader.IsBackground = true;
                reader.Start();
                Arm(desktop, desktopEvent); Arm(themes, themeEvent);
                Console.WriteLine("ready"); Console.Out.Flush();
                var events = new WaitHandle[] { stopped, desktopEvent, themeEvent };
                while (true) {
                    int index = WaitHandle.WaitAny(events);
                    if (index == 0) return;
                    if (index == 1) Arm(desktop, desktopEvent);
                    else Arm(themes, themeEvent);
                    Console.WriteLine("changed"); Console.Out.Flush();
                }
            }
        }
    }
}
'@
[BorrowedLight.RegistryMonitor]::Run()
} catch { [Console]::Error.WriteLine($_.Exception.GetBaseException().Message); exit 1 }
`;

/** WPF's on-demand WIC decoder exposes dimensions before CopyPixels/PNG encoding.
 * Read a JSON request on stdin; write ONLY PNG bytes on stdout (no path interpolation).
 * https://learn.microsoft.com/dotnet/api/system.windows.media.imaging.bitmapdecoder.create
 */
export const imageScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -AssemblyName PresentationCore, WindowsBase
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.maxPixels -lt 1000000 -or $request.maxPixels -gt 512000000) { throw 'Invalid image limit' }
    $source = [System.IO.File]::OpenRead($request.path)
    if ($source.Length -gt 2147483648) { throw 'Wallpaper exceeds the 2 GiB input limit' }
    $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($source, [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat, [System.Windows.Media.Imaging.BitmapCacheOption]::OnDemand)
    $frame = $decoder.Frames[0]
    if ($frame.PixelWidth -lt 1 -or $frame.PixelHeight -lt 1 -or $frame.PixelWidth -gt 65535 -or $frame.PixelHeight -gt 65535) { throw 'Invalid or excessive wallpaper dimensions' }
    if ([long]$frame.PixelWidth * $frame.PixelHeight -gt $request.maxPixels) { throw 'Wallpaper exceeds the configured megapixel input limit' }
    $orientation = 1
    try { $value = $frame.Metadata.GetQuery('/app1/ifd/{ushort=274}'); if ($null -ne $value) { $orientation = [int]$value } } catch { }
    $scale = 1024.0 / [Math]::Max($frame.PixelWidth, $frame.PixelHeight)
    if ($scale -lt 1) {
        $transform = New-Object System.Windows.Media.ScaleTransform($scale, $scale)
        $frame = New-Object System.Windows.Media.Imaging.TransformedBitmap($frame, $transform)
    }
    if ($orientation -ge 2 -and $orientation -le 8) {
        $group = New-Object System.Windows.Media.TransformGroup
        if ($orientation -in 2,4,5,7) { $group.Children.Add((New-Object System.Windows.Media.ScaleTransform(-1,1))) }
        $angle = switch ($orientation) { 3 {180} 4 {180} 5 {270} 6 {90} 7 {90} 8 {270} default {0} }
        if ($angle) { $group.Children.Add((New-Object System.Windows.Media.RotateTransform($angle))) }
        $frame = New-Object System.Windows.Media.Imaging.TransformedBitmap($frame, $group)
    }
    $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($frame))
    $output = New-Object System.IO.MemoryStream
    $encoder.Save($output)
    if ($output.Length -gt 8388608) { throw 'Normalized wallpaper exceeds the 8 MiB output limit' }
    $output.Position = 0
    $output.CopyTo([Console]::OpenStandardOutput())
    $output.Dispose()
    $source.Dispose()
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

/** Registry-only query: appearance following must not depend on wallpaper discovery. */
export const appearanceScript = String.raw`
$ErrorActionPreference = 'Stop'
$theme = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction SilentlyContinue
[Console]::Write($(if ($null -ne $theme -and $theme.SystemUsesLightTheme -eq 0) { 'dark' } else { 'light' }))
`;
