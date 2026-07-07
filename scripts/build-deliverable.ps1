param(
    [string]$ProjectRoot = (Get-Location).Path,
    [string]$DownloadDir = (Join-Path -Path $ProjectRoot -ChildPath "download")
)

$StagingDir  = Join-Path -Path $ProjectRoot -ChildPath ".rebase-staging"
$PkgName     = "osler-rebased"
$PkgDir      = Join-Path -Path $StagingDir -ChildPath $PkgName
$OutputZip   = Join-Path -Path $DownloadDir -ChildPath "$PkgName.zip"

Write-Host "[1/5] Cleaning previous staging + zip..."
if (Test-Path -LiteralPath $StagingDir) { Remove-Item -Recurse -Force -LiteralPath $StagingDir }
if (Test-Path -LiteralPath $OutputZip)  { Remove-Item -Force -LiteralPath $OutputZip }
New-Item -ItemType Directory -Force -Path $PkgDir | Out-Null
New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null

Write-Host "[2/5] Copying project files to staging..."
$topFiles = @(
    "package.json", "package-lock.json", "postcss.config.mjs",
    "tailwind.config.ts", "tsconfig.json", "next.config.ts",
    "components.json", "eslint.config.mjs", "Caddyfile",
    "OSLER_REBASE_README.md", "PATCH_NOTES_REBASE.md"
)
foreach ($f in $topFiles) {
    $src = Join-Path -Path $ProjectRoot -ChildPath $f
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination $PkgDir
    }
}

$dirs = @("src", "public", "prisma", "examples", "scripts")
foreach ($d in $dirs) {
    $src = Join-Path -Path $ProjectRoot -ChildPath $d
    if (Test-Path -LiteralPath $src) {
        Copy-Item -Recurse -LiteralPath $src -Destination $PkgDir
    }
}

@"
# dependencies
node_modules/
.pnp
.pnp.js

# next.js
.next/
out/
build/
dist/

# misc
.DS_Store
*.pem
.vscode/
.idea/

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
dev.log
server.log

# env files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# typescript
*.tsbuildinfo
next-env.d.ts

# prisma
prisma/dev.db
prisma/*.db-journal

# osler local data
osler-progress-v1
osler-ai-chat-v1
osler-written-drafts
"@ | Set-Content -LiteralPath (Join-Path -Path $PkgDir -ChildPath ".gitignore") -Encoding ASCII

"22" | Set-Content -LiteralPath (Join-Path -Path $PkgDir -ChildPath ".nvmrc") -Encoding ASCII

Write-Host "[3/5] Removing workspace/upload/skills artifacts from staging if present..."
$removeDirs = @("workspace", "upload", "download", "skills", ".zscripts", ".rebase-staging")
foreach ($rd in $removeDirs) {
    $path = Join-Path -Path $PkgDir -ChildPath $rd
    if (Test-Path -LiteralPath $path) { Remove-Item -Recurse -Force -LiteralPath $path }
}
$removeFiles = @("dev.log", "server.log")
foreach ($rf in $removeFiles) {
    $path = Join-Path -Path $PkgDir -ChildPath $rf
    if (Test-Path -LiteralPath $path) { Remove-Item -Force -LiteralPath $path }
}

$manifestPath = Join-Path -Path $PkgDir -ChildPath "public\osler-content\manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
    Write-Host "ERROR: Sample content missing from staging!"
    exit 1
}

Write-Host "[4/5] Zipping..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($OutputZip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $files = Get-ChildItem -Path $PkgDir -Recurse -File
    $baseLen = ($PkgDir.TrimEnd('\') + '\').Length
    foreach ($file in $files) {
        $relPath = $file.FullName.Substring($baseLen)
        $excluded = $false
        foreach ($pat in @("node_modules\", ".next\", ".git\", "dev.log", "server.log")) {
            if ($relPath -like "*$pat*") { $excluded = $true; break }
        }
        if (-not $excluded) {
            $entry = $zip.CreateEntryFromFile($file.FullName, $relPath, [System.IO.Compression.CompressionLevel]::Optimal)
        }
    }
} finally {
    $zip.Dispose()
}

Write-Host "[5/5] Done. Output:"
$zipItem = Get-Item -LiteralPath $OutputZip
Write-Host ("  Size: {0:N2} MB" -f ($zipItem.Length / 1MB))
Write-Host ""
Write-Host "Top-level contents of zip:"
$readZip = [System.IO.Compression.ZipFile]::OpenRead($OutputZip)
$entries = $readZip.Entries
$i = 0
foreach ($entry in $entries) {
    if ($entry.FullName -notlike "*/*") {
        Write-Host ("  {0}" -f $entry.FullName)
        $i++
        if ($i -ge 25) { break }
    }
}
Write-Host "..."
Write-Host ("Total entries: {0}" -f $entries.Count)
$readZip.Dispose()
