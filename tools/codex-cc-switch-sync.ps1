<#!
.SYNOPSIS
    Keeps Codex provider aliases valid after CC Switch rewrites config.toml.

CC Switch owns the live [model_providers.custom] block. This helper does not
replace that block or change the selected model. It mirrors the selected block
to [model_providers.cc-switch-official], which keeps conversations created with
that provider id loadable after a CC Switch provider change.
#>
[CmdletBinding()]
param(
    [switch]$Watch,
    [switch]$Once
)

$ErrorActionPreference = 'Stop'
$script:TaskName = 'Codex CC Switch provider sync'

function Get-ConfigPaths {
    $paths = [System.Collections.Generic.List[string]]::new()
    $codexHome = $env:CODEX_HOME
    if ($codexHome) { [void]$paths.Add((Join-Path $codexHome 'config.toml')) }

    # CC Switch stores the configured Codex directory in its settings. This is
    # usually D:\agent\.codex on this machine, while the desktop config may be
    # under the user's standard C:\Users\...\.codex directory.
    $settings = Join-Path $env:USERPROFILE '.cc-switch\settings.json'
    if (Test-Path -LiteralPath $settings) {
        try {
            $s = Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
            $configured = $s.localMigrations.codexOfficialHistoryUnifyV1.codexConfigDir
            if ($configured) {
                $configured = $configured -replace '^\\\\\?\\', ''
                [void]$paths.Add((Join-Path $configured 'config.toml'))
            }
        } catch { }
    }

    [void]$paths.Add((Join-Path $env:USERPROFILE '.codex\config.toml'))
    $paths | Where-Object { $_ } | ForEach-Object { [System.IO.Path]::GetFullPath($_) } | Sort-Object -Unique
}

function Get-Section {
    param([string]$Text, [string]$Name)
    $escaped = [regex]::Escape($Name)
    $match = [regex]::Match($Text, "(?ms)^\[$escaped\]\s*\r?\n(.*?)(?=^\[|\z)")
    if ($match.Success) { return $match.Groups[1].Value.TrimEnd() }
    return $null
}

function Set-Section {
    param([string]$Text, [string]$Name, [string]$Body)
    $escaped = [regex]::Escape($Name)
    $newBlock = "[$Name]`r`n$Body`r`n"
    $pattern = "(?ms)^\[$escaped\]\s*\r?\n.*?(?=^\[|\z)"
    if ([regex]::IsMatch($Text, $pattern)) {
        return [regex]::Replace($Text, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $newBlock }, 1)
    }
    return ($Text.TrimEnd() + "`r`n`r`n" + $newBlock)
}

function Sync-Config {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $before = [System.IO.File]::ReadAllText($Path)
    $custom = Get-Section -Text $before -Name 'model_providers.custom'
    $official = Get-Section -Text $before -Name 'model_providers.cc-switch-official'

    # CC Switch normally writes custom. If a user manually selected the legacy
    # alias, use it as the source instead, so the two names stay interchangeable.
    $source = if ($custom) { $custom } else { $official }
    if (-not $source) { return $false }
    $after = Set-Section -Text $before -Name 'model_providers.cc-switch-official' -Body $source
    if ($after -eq $before) { return $false }

    $tmp = "$Path.codex-cc-switch-sync.tmp"
    [System.IO.File]::WriteAllText($tmp, $after, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tmp -Destination $Path -Force
    return $true
}

function Sync-All {
    foreach ($path in Get-ConfigPaths) {
        try { [void](Sync-Config -Path $path) } catch { }
    }
}

Sync-All
if (-not $Watch) { exit 0 }

$watchers = @()
$handlers = @()
foreach ($path in Get-ConfigPaths) {
    $directory = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { continue }
    $watcher = New-Object System.IO.FileSystemWatcher $directory, (Split-Path -Leaf $path)
    $watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::Size
    $watcher.EnableRaisingEvents = $true
    $action = {
        Start-Sleep -Milliseconds 250
        try { Sync-Config -Path $Event.SourceEventArgs.FullPath } catch { }
    }
    $handlers += Register-ObjectEvent -InputObject $watcher -EventName Changed -Action $action
    $handlers += Register-ObjectEvent -InputObject $watcher -EventName Created -Action $action
    $watchers += $watcher
}

try {
    while ($true) { Wait-Event -Timeout 5 | Out-Null }
} finally {
    $handlers | Unregister-Event -Force -ErrorAction SilentlyContinue
    $watchers | ForEach-Object { $_.Dispose() }
}
