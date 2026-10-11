Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile('C:\Users\ik515\OneDrive\Documents\Default Project\hero-source.jpg')
$srcW = $src.Width
$srcH = $src.Height
$dstW = 1200
$dstH = 630

# Calculate crop dimensions to fill 1200x630 while maintaining aspect ratio
$srcRatio = $srcW / $srcH
$dstRatio = $dstW / $dstH

if ($srcRatio -gt $dstRatio) {
    # Source is wider — match height, crop sides
    $cropH = $srcH
    $cropW = [int]($srcH * $dstRatio)
} else {
    # Source is taller — match width, crop top/bottom
    $cropW = $srcW
    $cropH = [int]($srcW / $dstRatio)
}

$srcX = [int](($srcW - $cropW) / 2)
$srcY = [int](($srcH - $cropH) / 2)

$bmp = New-Object System.Drawing.Bitmap($dstW, $dstH)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gfx.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$gfx.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $dstW, $dstH)), (New-Object System.Drawing.Rectangle($srcX, $srcY, $cropW, $cropH)), [System.Drawing.GraphicsUnit]::Pixel)

$bmp.Save('C:\Users\ik515\OneDrive\Documents\Default Project\og-image.jpg', [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bmp.Dispose()
$gfx.Dispose()
$src.Dispose()

Write-Output 'og-image.jpg created successfully'
