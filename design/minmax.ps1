Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MM {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MINMAXINFO {
    public POINT ptReserved, ptMaxSize, ptMaxPosition, ptMinTrackSize, ptMaxTrackSize;
  }
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, ref MINMAXINFO lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
$p = Get-Process desko -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Output "no desko process"; exit }
$mmi = New-Object MM+MINMAXINFO
$rect = New-Object MM+RECT
[void][MM]::GetWindowRect($p.MainWindowHandle, [ref]$rect)
$res = [IntPtr]::Zero
# WM_GETMINMAXINFO = 0x0024, SMTO_NORMAL = 0
[void][MM]::SendMessageTimeout($p.MainWindowHandle, 0x0024, [IntPtr]::Zero, [ref]$mmi, 0, 1000, [ref]$res)
Write-Output ("hwnd=" + $p.MainWindowHandle)
Write-Output ("windowRect=" + ($rect.R-$rect.L) + "x" + ($rect.B-$rect.T))
Write-Output ("ptMinTrackSize=" + $mmi.ptMinTrackSize.X + "x" + $mmi.ptMinTrackSize.Y)
Write-Output ("ptMaxTrackSize=" + $mmi.ptMaxTrackSize.X + "x" + $mmi.ptMaxTrackSize.Y)
