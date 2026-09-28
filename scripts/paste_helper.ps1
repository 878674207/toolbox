param([string]$mode)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class PH {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
}
'@
if ($mode -eq 'hide-toolbox') {
  $tb = Get-Process toolbox | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($tb) { [PH]::ShowWindow($tb.MainWindowHandle, 0) | Out-Null; Write-Output 'hidden' } else { Write-Output 'no-toolbox' }
} elseif ($mode -eq 'fg-notepad') {
  $p = Get-Process notepad++ -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) { [PH]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Write-Output 'fg-ok' } else { Write-Output 'no-notepad' }
} elseif ($mode -eq 'title') {
  $p = Get-Process notepad++ -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) { $sb = New-Object System.Text.StringBuilder 512; [PH]::GetWindowText($p.MainWindowHandle, $sb, 512) | Out-Null; Write-Output $sb.ToString() } else { Write-Output 'no-notepad' }
}
