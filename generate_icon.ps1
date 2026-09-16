Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap(1024,1024)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAlias'

# 背景渐变
$rect = New-Object System.Drawing.Rectangle(0,0,1024,1024)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(26,115,232), [System.Drawing.Color]::FromArgb(66,133,244))
$g.FillRectangle($brush, $rect)

# 绘制 "D" 字母
$font = New-Object System.Drawing.Font('Arial',500,[System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = 'Center'
$sf.LineAlignment = 'Center'
$rectF = New-Object System.Drawing.RectangleF(0,0,1024,1024)
$g.DrawString('D', $font, $textBrush, $rectF, $sf)

$g.Dispose()
$bmp.Save("$PSScriptRoot\app-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host "Icon created: app-icon.png"
