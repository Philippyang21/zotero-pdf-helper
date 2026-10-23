param([string]$NodePath='node',[string]$EdgePath='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',[string[]]$Only=@())
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
& $NodePath (Join-Path $PSScriptRoot 'render_docs.cjs')
if($LASTEXITCODE -ne 0){throw 'Documentation HTML generation failed'}
$htmlRoot=Join-Path $projectRoot 'work/docs-preview'
$imageRoot=Join-Path $projectRoot 'docs/images'
New-Item -ItemType Directory -Path $imageRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'plugin/icons/icon-96.png') -Destination (Join-Path $imageRoot 'logo.png')
$shots=@(
  @{Name='video-tutorial';Page='video-tutorial.html';Height=675},
  @{Name='workflow';Page='workflow.html';Height=580},
  @{Name='installation';Page='installation.html';Height=560},
  @{Name='text-settings';Page='settings.html?page=text&light=1';Height=1160},
  @{Name='text-preview';Page='settings.html?page=preview&light=1';Height=980},
  @{Name='ocr-settings';Page='settings.html?page=account&light=1';Height=900},
  @{Name='python-settings';Page='settings.html?page=python&light=1';Height=840},
  @{Name='task-progress';Page='progress.html';Height=980}
)
foreach($shot in $shots){
  if($Only.Count -gt 0 -and $shot.Name -notin $Only){continue}
  $pageParts=$shot.Page -split '\?',2
  $url=([Uri](Join-Path $htmlRoot $pageParts[0])).AbsoluteUri
  if($pageParts.Count -gt 1){$url+='?'+$pageParts[1]}
  $argsList=@('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--disable-background-networking','--disable-extensions','--allow-file-access-from-files',
    '--virtual-time-budget=9000','--force-device-scale-factor=1',
    ('--user-data-dir="'+(Join-Path $htmlRoot ('profile-'+$PID+'-'+$shot.Name))+'"'),
    ('--screenshot="'+(Join-Path $imageRoot ($shot.Name+'.png'))+'"'),
    ('--window-size=1200,'+$shot.Height),('"'+$url+'"'))
  $process=Start-Process -FilePath $EdgePath -ArgumentList $argsList -WindowStyle Hidden -PassThru `
    -RedirectStandardError (Join-Path $htmlRoot ($shot.Name+'.log'))
  if(!$process.WaitForExit(25000)){
    Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
    throw ('Screenshot timed out: '+$shot.Name)
  }
  if(!(Test-Path -LiteralPath (Join-Path $imageRoot ($shot.Name+'.png')))){throw ('Missing screenshot: '+$shot.Name)}
}
Write-Output 'Documentation screenshots generated.'
