$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'This installer is for Windows.' }
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
if ($arch -ne 'X64') { throw 'Use the x64 release on x64 Windows. Native Windows ARM is not packaged yet.' }
$base = 'https://github.com/badenb/sled-dog/releases/latest/download'
$asset = 'sled-dog-windows-x86_64.zip'
$work = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
$dest = Join-Path $env:LOCALAPPDATA 'Programs\Sled Dog'
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest "$base/$asset" -OutFile (Join-Path $work $asset) -UseBasicParsing
    Invoke-WebRequest "$base/$asset.sha256" -OutFile (Join-Path $work "$asset.sha256") -UseBasicParsing
    $expected = ((Get-Content (Join-Path $work "$asset.sha256") -Raw) -split '\s+')[0]
    $actual = (Get-FileHash (Join-Path $work $asset) -Algorithm SHA256).Hash
    if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or $actual -ne $expected) { throw 'Checksum mismatch. Nothing installed.' }
    Expand-Archive (Join-Path $work $asset) (Join-Path $work 'unpacked')
    $binary = Join-Path $work 'unpacked\sled-dog.exe'
    & $binary --version
    if ($LASTEXITCODE -ne 0) { throw 'Downloaded executable failed its version check.' }
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Copy-Item $binary (Join-Path $dest 'sled-dog.new.exe') -Force
    Move-Item (Join-Path $dest 'sled-dog.new.exe') (Join-Path $dest 'sled-dog.exe') -Force
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (($userPath -split ';') -notcontains $dest) {
        [Environment]::SetEnvironmentVariable('Path', "$dest;$userPath", 'User')
    }
    $env:Path = "$dest;$env:Path"
    Write-Output 'Installed. Run: sled-dog auth login --host github.com'
} finally {
    Remove-Item -Recurse -Force $work
}
