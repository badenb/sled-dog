# Exercise the real installer against locally built artifacts, without network access.
$ErrorActionPreference = 'Stop'
$assetRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\release')).Path
$work = Join-Path $env:RUNNER_TEMP ('sled-dog-install-test-' + [Guid]::NewGuid())
$originalLocal = $env:LOCALAPPDATA
$originalPath = $env:Path
$originalUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
function Invoke-WebRequest {
    param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
    $name = ($Uri -split '/')[-1]
    Copy-Item (Join-Path $assetRoot $name) $OutFile
}
try {
    $env:LOCALAPPDATA = $work
    & (Join-Path $PSScriptRoot 'install.ps1')
    $installed = Join-Path $work 'Programs\Sled Dog\sled-dog.exe'
    if (-not (Test-Path $installed)) { throw 'Installer did not create executable.' }
    & $installed --version
    if ($LASTEXITCODE -ne 0) { throw 'Installed executable failed.' }
    $before = (Get-FileHash $installed -Algorithm SHA256).Hash
    $checksum = Join-Path $assetRoot 'sled-dog-windows-x86_64.zip.sha256'
    $originalChecksum = Get-Content $checksum -Raw
    try {
        Set-Content $checksum ('0' * 64)
        $failed = $false
        try { & (Join-Path $PSScriptRoot 'install.ps1') } catch { $failed = $true }
        if (-not $failed) { throw 'Installer accepted an invalid checksum.' }
        if ((Get-FileHash $installed -Algorithm SHA256).Hash -ne $before) { throw 'Failed update changed installed binary.' }
    } finally { Set-Content $checksum $originalChecksum -NoNewline }
} finally {
    $env:LOCALAPPDATA = $originalLocal
    $env:Path = $originalPath
    [Environment]::SetEnvironmentVariable('Path', $originalUserPath, 'User')
    if (Test-Path $work) { Remove-Item $work -Recurse -Force }
}
