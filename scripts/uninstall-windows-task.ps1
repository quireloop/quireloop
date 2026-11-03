# Removes the task that `npm run service:install` made, and stops Quireloop.
$ErrorActionPreference = 'Stop'

$TaskName = 'Quireloop'
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host 'Quireloop no longer starts when you log in. Your papers are untouched.'
} else {
  Write-Host 'Quireloop was not set to start automatically.'
}
# Stopping the task can leave the server itself running; end the one it started.
$Launcher = Join-Path $env:LOCALAPPDATA 'Quireloop\start-quireloop.ps1'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*src\start.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $Launcher -Force -ErrorAction SilentlyContinue
