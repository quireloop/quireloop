# Starts Quireloop when you log in to Windows and restarts it if it crashes,
# as a Task Scheduler task for your own account: no admin rights needed.
# Run through `npm run service:install`, which fills in the parameters.
param(
  [Parameter(Mandatory)] [string] $Node,
  [Parameter(Mandatory)] [string] $Server,
  [string] $Port = '4173'
)
$ErrorActionPreference = 'Stop'

$TaskName = 'Quireloop'
$Home_ = Join-Path $env:LOCALAPPDATA 'Quireloop'
$LogDir = Join-Path $Home_ 'Logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# The task runs a small launcher rather than one long command line, which
# would need quotes nested three deep to survive a path with spaces in it.
function Quote([string] $s) { "'" + $s.Replace("'", "''") + "'" }
$Launcher = Join-Path $Home_ 'start-quireloop.ps1'
@"
`$env:PORT = $(Quote $Port)
`$p = Start-Process -FilePath $(Quote $Node) -ArgumentList 'src\start.js' ``
  -WorkingDirectory $(Quote $Server) -NoNewWindow -Wait -PassThru ``
  -RedirectStandardOutput $(Quote (Join-Path $LogDir 'server.log')) ``
  -RedirectStandardError $(Quote (Join-Path $LogDir 'server.error.log'))
# Passing the exit code on is what makes Task Scheduler restart it after a crash.
exit `$p.ExitCode
"@ | Set-Content -Encoding UTF8 -LiteralPath $Launcher

# node.exe is a console program, so it runs inside a hidden PowerShell window.
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# No time limit, keep going on battery, and up to 999 restarts a minute apart.
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
  -Principal $Principal -Description 'Quireloop LaTeX editor' | Out-Null
Start-ScheduledTask -TaskName $TaskName

Start-Sleep -Seconds 3
try {
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://localhost:$Port/" | Out-Null
  Write-Host "Quireloop is running and will start when you log in: http://localhost:$Port"
} catch {
  Write-Host "Installed, but the server didn't answer yet. If another copy is already using port $Port, stop it first."
}
Write-Host "Logs: $LogDir"
Write-Host 'To remove it: npm run service:uninstall'
