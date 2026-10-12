param([ValidateSet('build','install','verify','uninstall')][string]$Mode='build')
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$acceptanceRoot=[IO.Path]::GetFullPath((Join-Path $workspace '.release-tools/inn-install-20261011'))
$installRoot=[IO.Path]::GetFullPath((Join-Path $acceptanceRoot 'installed'))
if(-not $installRoot.StartsWith($workspace+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Acceptance target escaped workspace'}
$productName='Xmission-Acceptance-20261011-Inn'
$binaryName='xmission-inn-acceptance'
$registryPath="HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$productName"
$output=Join-Path $acceptanceRoot 'acceptance-setup.exe'
if($Mode -eq 'build'){
 New-Item -ItemType Directory -Path $acceptanceRoot -Force | Out-Null
 $sourceExe=Join-Path $workspace 'src-tauri/target/x86_64-pc-windows-gnu/debug/xmission.exe'
 $snapshot=Join-Path $acceptanceRoot 'payload-xmission.exe'
 & node (Join-Path $PSScriptRoot 'check-installed-payload.mjs') '--stage' $sourceExe $snapshot
 if($LASTEXITCODE -ne 0){throw 'Native payload staging failed'}
 $generated=Join-Path $workspace 'src-tauri/target/x86_64-pc-windows-gnu/debug/nsis/x64'
 $text=Get-Content -LiteralPath (Join-Path $generated 'installer.nsi') -Raw
 foreach($pair in @(@('PRODUCTNAME',$productName),@('MAINBINARYNAME',$binaryName),@('MAINBINARYSRCPATH',$snapshot),@('BUNDLEID','com.xmission.acceptance.inn'),@('OUTFILE',$output))){
  $pattern='(?m)^!define '+$pair[0]+' "[^"]*"'
  if([regex]::Matches($text,$pattern).Count -ne 1){throw "Missing unique NSIS definition: $($pair[0])"}
  $replacement='!define '+$pair[0]+' "'+$pair[1]+'"'
  $replaceDefinition={param($match) $replacement}.GetNewClosure()
  $text=[regex]::Replace($text,$pattern,[System.Text.RegularExpressions.MatchEvaluator]$replaceDefinition)
 }
 # Rename only the installed executable and test identities. Payload and install rules stay identical.
 $text=$text.Replace('File "${MAINBINARYSRCPATH}"','File /oname=${MAINBINARYNAME}.exe "${MAINBINARYSRCPATH}"')
 if(-not $text.Contains('File /oname=${MAINBINARYNAME}.exe "${MAINBINARYSRCPATH}"')){throw 'Main payload mapping was not verified'}
 foreach($include in Get-ChildItem -LiteralPath $generated -Filter '*.nsh' -File){Copy-Item -LiteralPath $include.FullName -Destination (Join-Path $acceptanceRoot $include.Name) -Force}
 $source=Join-Path $acceptanceRoot 'acceptance.nsi'
 [IO.File]::WriteAllText($source,$text,[Text.UTF8Encoding]::new($false))
 $makensis=Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe'
 & $makensis '/INPUTCHARSET' 'UTF8' $source
 if($LASTEXITCODE -ne 0){throw 'Acceptance installer compilation failed'}
 Write-Output "Built isolated installer: $output"
}elseif($Mode -in @('install','verify')){
 if($Mode -eq 'install'){
 if(Test-Path -LiteralPath $registryPath){throw 'Refusing to replace a prior acceptance registration'}
 if(Test-Path -LiteralPath $installRoot){throw 'Refusing to replace an existing installation directory'}
 $process=Start-Process -FilePath $output -ArgumentList @('/S','/NS',"/D=$installRoot") -WindowStyle Hidden -PassThru -Wait
 if($process.ExitCode -ne 0){throw "Installer failed: $($process.ExitCode)"}
 }
 foreach($name in @("$binaryName.exe",'WebView2Loader.dll','uninstall.exe')){if(-not(Test-Path -LiteralPath (Join-Path $installRoot $name))){throw "Installed dependency missing: $name"}}
 $sourceExe=Join-Path $workspace 'src-tauri/target/x86_64-pc-windows-gnu/debug/xmission.exe'
 & node (Join-Path $PSScriptRoot 'check-installed-payload.mjs') $sourceExe (Join-Path $installRoot "$binaryName.exe")
 if($LASTEXITCODE -ne 0){throw 'Installed binary differs from reviewed native build'}
 $entry=Get-ItemProperty -LiteralPath $registryPath
 if($entry.InstallLocation -and [IO.Path]::GetFullPath($entry.InstallLocation.Trim('"')) -ne $installRoot){throw 'Unexpected installer registration location'}
 Write-Output "PASS: installed exact native payload and loader, separate registration: $installRoot"
}else{
 $uninstaller=Join-Path $installRoot 'uninstall.exe'
 if(-not(Test-Path -LiteralPath $uninstaller)){throw 'Acceptance uninstaller is missing'}
 if(Get-Process -Name $binaryName -ErrorAction SilentlyContinue){throw 'Close the isolated acceptance application before uninstall'}
 $process=Start-Process -FilePath $uninstaller -ArgumentList @('/S',"_?=$installRoot") -WindowStyle Hidden -PassThru -Wait
 if($process.ExitCode -ne 0){throw "Uninstaller failed: $($process.ExitCode)"}
 if(Test-Path -LiteralPath $registryPath){throw 'Acceptance registration remains after uninstall'}
 if(Test-Path -LiteralPath (Join-Path $installRoot "$binaryName.exe")){throw 'Acceptance executable remains after uninstall'}
 # _?= makes NSIS run synchronously in place; after it exits, remove only its own file.
 if(Test-Path -LiteralPath $uninstaller){Remove-Item -LiteralPath $uninstaller -Force}
 if(Test-Path -LiteralPath $installRoot){
  if(@(Get-ChildItem -LiteralPath $installRoot -Force).Count -ne 0){throw 'Unexpected files remain; acceptance directory was not removed'}
  Remove-Item -LiteralPath $installRoot
 }
 Write-Output 'PASS: isolated installation removed and registration cleaned; user database resides outside install directory'
}
