# Renders the synthetic sample HTML files to PDF (A4) using headless Chrome or Edge.
# The synthetic PDFs mimic the layout of real clinic scan sheets (treatment table +
# implant sticker + handwritten notes) but contain NO real patient data.
# Usage:  powershell -File test/synthetic-src/make-pdfs.ps1
$ErrorActionPreference = 'Stop'
$srcDir = $PSScriptRoot
$outDir = Split-Path $srcDir -Parent   # test/

$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw "Neither Chrome nor Edge found." }

Get-ChildItem $srcDir -Filter *.html | ForEach-Object {
  $pdf = Join-Path $outDir ($_.BaseName + '.pdf')
  & $browser --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="$pdf" $_.FullName | Out-Null
  Write-Host "wrote $pdf"
}
