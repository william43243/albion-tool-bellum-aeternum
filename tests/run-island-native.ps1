param(
  [Parameter(Mandatory=$true)][string]$Jdk,
  [Parameter(Mandatory=$true)][string]$KotlinLib,
  [Parameter(Mandatory=$true)][string]$JsonJar
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$out = 'android/app/build/island-jvm-test'
New-Item -ItemType Directory -Force $out | Out-Null
$stdlib = (Get-ChildItem $KotlinLib -Filter 'kotlin-stdlib-*.jar' | Where-Object { $_.Name -match '^kotlin-stdlib-[0-9]' } | Select-Object -First 1).FullName
if (!$stdlib) { throw 'Kotlin standard library not found.' }
$classpath = "$out;$JsonJar;$stdlib"
& "$Jdk/bin/java.exe" -cp "$KotlinLib/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -classpath $classpath -d $out android/app/src/main/java/com/albion/market/litert/IslandEconomics.kt
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$Jdk/bin/javac.exe" -encoding UTF-8 -cp $classpath -d $out tests/island-native/IslandEconomicsTest.java
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$Jdk/bin/java.exe" -cp $classpath IslandEconomicsTest
exit $LASTEXITCODE
