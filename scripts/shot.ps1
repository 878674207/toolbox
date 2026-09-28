$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

[Win]::SetProcessDPIAware() | Out-Null
# target button name: "\u65f6\u95f4\u6233\u8f6c\u6362" (timestamp tool nav item)
$name = [string]::Join('', [char[]](0x65F6, 0x95F4, 0x6233, 0x8F6C, 0x6362))

$p = Get-Process toolbox | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { throw "toolbox process not found" }
[Win]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 800

$r = New-Object Win+RECT
[Win]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = [int]$r.Right - [int]$r.Left
$h = [int]$r.Bottom - [int]$r.Top

function Shot($path) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen([int]$r.Left, [int]$r.Top, 0, 0, $bmp.Size)
  $bmp.Save($path)
  $g.Dispose(); $bmp.Dispose()
}

Shot "E:\tools\toolbox\shot-case.png"

# mouse click the second nav item at (80,143) relative to window rect
[Win]::SetCursorPos([int]$r.Left + 80, [int]$r.Top + 143)
Start-Sleep -Milliseconds 300
[Win]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
[Win]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 1000
Shot "E:\tools\toolbox\shot-timestamp.png"

Write-Output "done: clicked nav item 2"
