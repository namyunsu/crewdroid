# Tray icon for the hidden emulators (Windows). Started by up through src/tray.ts; keep this file ASCII, PowerShell 5.1 reads it as ANSI.
# $State = what up wrote, $Activity = last command (one line, its mtime is the time). Quits when down removes $State or the emulators are gone.
param([string]$State, [string]$Activity)

$mutex = New-Object System.Threading.Mutex($false, 'Local\crewdroid-tray')
if (-not $mutex.WaitOne(0)) { exit }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$icon = New-Object System.Windows.Forms.NotifyIcon
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$icon.ContextMenuStrip = $menu
$script:badge = ''
$script:misses = 0
$script:s = $null
$script:running = @()

function Set-Badge([int]$n, [bool]$ready) {
  $key = "$n $ready"
  if ($key -eq $script:badge) { return }
  $script:badge = $key
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $color = if ($ready) { '#15803D' } else { '#B45309' }
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($color))
  $g.FillEllipse($brush, 0, 0, 31, 31)
  $font = New-Object System.Drawing.Font 'Segoe UI', 19, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'
  $fmt.LineAlignment = 'Center'
  $g.DrawString("$n", $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 0, 32, 32), $fmt)
  $g.Dispose()
  $icon.Icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

function Quit {
  Remove-Item -LiteralPath $State, $Activity -ErrorAction SilentlyContinue
  $icon.Visible = $false
  $icon.Dispose()
  [System.Windows.Forms.Application]::Exit()
}

function Get-Headline {
  $n = @($script:s.devices).Count
  $unit = if ($n -eq 1) { 'device' } else { 'devices' }
  if ($script:s.status -ne 'ready') { return "crewdroid: starting $n $unit" }
  $alive = @($script:s.devices | Where-Object { $script:running -contains $_.port }).Count
  if ($alive -eq $n) { return "crewdroid: $n $unit running" }
  return "crewdroid: $alive of $n $unit running"
}

function Get-Last {
  if (-not (Test-Path -LiteralPath $Activity)) { return 'No command yet' }
  $age = [int]((Get-Date) - (Get-Item -LiteralPath $Activity).LastWriteTime).TotalSeconds
  $when = if ($age -lt 90) { "$age s ago" } else { "$([int]($age / 60)) min ago" }
  return "Last: $([IO.File]::ReadAllText($Activity).Trim()) ($when)"
}

function Update {
  if (-not (Test-Path -LiteralPath $State)) { Quit; return }
  try { $script:s = [IO.File]::ReadAllText($State) | ConvertFrom-Json } catch { return } # mid-write: keep the last one, next tick reads it
  # an emulator's console listens on its port; this costs a fraction of a WMI process query every tick
  $listening = @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port)
  $script:running = @(@($script:s.devices.port) | Where-Object { $listening -contains $_ })
  $ready = $script:s.status -eq 'ready'
  if ($ready) {
    $script:misses = if ($script:running.Count) { 0 } else { $script:misses + 1 }
    if ($script:misses -ge 2) { Quit; return }
  } elseif (-not (Get-Process -Id $script:s.pid -ErrorAction SilentlyContinue)) { Quit; return } # up died before it was ready
  Set-Badge $(if ($ready) { $script:running.Count } else { @($script:s.devices).Count }) $ready # ready: only the ones still alive
  $tip = "$(Get-Headline)`n$(Get-Last)"
  $icon.Text = $tip.Substring(0, [Math]::Min(63, $tip.Length))
}

$menu.add_Opening({
  param($sender, $e)
  $e.Cancel = $false
  $menu.Items.Clear()
  $lines = @(Get-Headline) + @($script:s.devices | ForEach-Object {
    $off = if ($script:s.status -eq 'ready' -and $script:running -notcontains $_.port) { '  (stopped)' } else { '' }
    "$($_.serial)   $($_.profile)   API $($_.api)$off"
  }) + @(Get-Last)
  foreach ($l in $lines) { [void]$menu.Items.Add($l) }
})

# a plain left click opens the same menu; NotifyIcon only keeps that method private
$icon.add_MouseUp({
  param($sender, $e)
  if ($e.Button -eq 'Left') { $icon.GetType().GetMethod('ShowContextMenu', [Reflection.BindingFlags]'Instance,NonPublic').Invoke($icon, $null) }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({ Update })

Update
if ($script:s) {
  $icon.Visible = $true
  # Windows 11 tucks new icons under the ^ arrow, so say once that it is there
  $icon.ShowBalloonTip(4000, 'crewdroid', (Get-Headline), 'Info')
  $timer.Start()
  # PowerShell and WinForms start-up pages are never used again: give them back (100 MB down to 51 MB, measured over 8 min)
  [GC]::Collect()
  $me = Get-Process -Id $PID
  $me.MaxWorkingSet = $me.MinWorkingSet
  $me.MaxWorkingSet = [IntPtr]([int64]1400MB)
  [System.Windows.Forms.Application]::Run()
}
