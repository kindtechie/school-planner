$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

if ($env:OS -ne "Windows_NT") { throw "Build this package on Windows 10/11 x64." }
function Run-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $Program (exit $LASTEXITCODE)" }
}

Run-Checked "py" @("-3.12", "-m", "venv", ".build-venv")
$Python = Join-Path (Get-Location) ".build-venv\Scripts\python.exe"
Run-Checked $Python @("-m", "pip", "install", "-r", "requirements.txt", "pyinstaller==6.22.0")
Run-Checked $Python @("-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py")
Run-Checked $Python @("-m", "PyInstaller", "--noconfirm", "--clean", "--windowed", "--onedir", "--name", "HamDars", "--add-data", "web;web", "--collect-all", "ortools", "--collect-all", "reportlab", "--collect-all", "arabic_reshaper", "--collect-all", "bidi", "run.py")

$Compiler = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
$IsccPath = if ($Compiler) { $Compiler.Source } else { Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe" }
if (-not (Test-Path $IsccPath)) {
    throw "Portable application built at dist\HamDars. Install Inno Setup 6 from https://jrsoftware.org/isdl.php and run this script again to create the installer."
}
Run-Checked $IsccPath @("packaging\installer.iss")
Write-Host "Installer ready: dist\HamDars-Setup-1.0.0-x64.exe"
