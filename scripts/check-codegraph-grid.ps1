$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$tempRoot = Join-Path $env:TEMP 'codegraph-grid-check'
$videoPath = Join-Path $tempRoot 'codegraphintro-sample.mp4'
$framePath = Join-Path $tempRoot 'codegraphintro-frame0.png'

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

Write-Host 'Rendering CodeGraphIntro sample video...'
npx remotion render src/index.ts CodeGraphIntro $videoPath --frames=0-29
if ($LASTEXITCODE -ne 0) {
  throw "Remotion render failed with exit code $LASTEXITCODE"
}

Write-Host 'Extracting first encoded frame...'
ffmpeg -y -i $videoPath -frames:v 1 -update 1 $framePath | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "ffmpeg frame extraction failed with exit code $LASTEXITCODE"
}

$bitmap = [System.Drawing.Bitmap]::FromFile($framePath)

$samples = @(
  # Sample below the intentional top fade and aligned to the 60px grid.
  @{ Name = 'background'; X = 30; Y = 210; Min = 0 },
  @{ Name = 'verticalLine'; X = 60; Y = 210; Min = 6 },
  @{ Name = 'horizontalLine'; X = 30; Y = 240; Min = 6 },
  @{ Name = 'gridIntersection'; X = 60; Y = 240; Min = 10 }
)

$failures = @()

foreach ($sample in $samples) {
  $pixel = $bitmap.GetPixel($sample.X, $sample.Y)
  $brightness = [Math]::Round(($pixel.R + $pixel.G + $pixel.B) / 3, 2)
  Write-Host ("{0}: ({1},{2}) => RGB({3},{4},{5}) avg={6}" -f `
    $sample.Name, $sample.X, $sample.Y, $pixel.R, $pixel.G, $pixel.B, $brightness)

  if ($brightness -lt $sample.Min) {
    $failures += "{0} brightness {1} is below required minimum {2}" -f `
      $sample.Name, $brightness, $sample.Min
  }
}

$bitmap.Dispose()

if ($failures.Count -gt 0) {
  throw ("Grid visibility check failed:`n- " + ($failures -join "`n- "))
}

Write-Host 'Grid visibility check passed.'
