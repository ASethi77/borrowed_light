$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ImageProfileProcesses {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct Entry {
        public uint Size, Usage, Id; public IntPtr Heap;
        public uint Module, Threads, Parent; public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Name;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint id);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static int[] Tree(int root) {
        var snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) throw new Exception("Cannot enumerate processes");
        try {
            var parents = new Dictionary<int,int>();
            var entry = new Entry { Size = (uint)Marshal.SizeOf(typeof(Entry)) };
            if (Process32FirstW(snapshot, ref entry)) do { parents[(int)entry.Id] = (int)entry.Parent; } while (Process32NextW(snapshot, ref entry));
            var found = new HashSet<int> { root };
            bool added;
            do { added = false; foreach (var pair in parents) if (found.Contains(pair.Value) && found.Add(pair.Key)) added = true; } while (added);
            var output = new int[found.Count]; found.CopyTo(output); return output;
        } finally { CloseHandle(snapshot); }
    }
}
'@
$request = [Console]::In.ReadLine() | ConvertFrom-Json
$targetPid = [int]$request.pid
[Console]::WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($null -ne (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) {
    $values = @([ImageProfileProcesses]::Tree($targetPid) | ForEach-Object {
        $profilePid = $_
        try {
            $process = [System.Diagnostics.Process]::GetProcessById($profilePid)
            @{ pid=$profilePid; rss=$process.WorkingSet64; highWater=$process.PeakWorkingSet64; cpuMs=$process.TotalProcessorTime.TotalMilliseconds }
            $process.Dispose()
        } catch { }
    })
    [Console]::WriteLine((@{ processes=$values } | ConvertTo-Json -Compress -Depth 4))
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 50
}
