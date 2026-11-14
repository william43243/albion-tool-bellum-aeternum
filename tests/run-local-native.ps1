param(
  [Parameter(Mandatory=$true)][string]$Jdk,
  [Parameter(Mandatory=$true)][string]$KotlinLib
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$out = 'android/app/build/local-runtime-jvm-test'
New-Item -ItemType Directory -Force $out | Out-Null
$stdlib = (Get-ChildItem $KotlinLib -Filter 'kotlin-stdlib-*.jar' | Where-Object { $_.Name -match '^kotlin-stdlib-[0-9]' } | Select-Object -First 1).FullName
if (!$stdlib) { throw 'Kotlin standard library not found.' }
& "$Jdk/bin/java.exe" -cp "$KotlinLib/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -classpath $stdlib -d $out android/app/src/main/java/com/albion/market/litert/LocalRuntimeOptions.kt tests/local-native/LocalRuntimeOptionsHarness.kt
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$Jdk/bin/java.exe" -cp "$out;$stdlib" LocalRuntimeOptionsHarnessKt
exit $LASTEXITCODE
