param([Parameter(Mandatory=$true)][string]$Jdk,[Parameter(Mandatory=$true)][string]$KotlinLib,[Parameter(Mandatory=$true)][string]$JsonJar)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$out='android/app/build/island-history-batch-jvm-test'
New-Item -ItemType Directory -Force $out | Out-Null
$stdlib=(Get-ChildItem $KotlinLib -Filter 'kotlin-stdlib-*.jar' | Where-Object { $_.Name -match '^kotlin-stdlib-[0-9]' } | Select-Object -First 1).FullName
if (!$stdlib) { throw 'Kotlin standard library not found.' }
& "$Jdk/bin/javac.exe" -encoding UTF-8 -d $out android/app/src/main/java/com/albion/market/litert/MarketNumeric.java android/app/src/main/java/com/albion/market/litert/HistoryWindow.java android/app/src/main/java/com/albion/market/litert/HistoryAggregate.java
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$classpath="$out;$JsonJar;$stdlib"
& "$Jdk/bin/java.exe" -cp "$KotlinLib/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -classpath $classpath -d $out android/app/src/main/java/com/albion/market/litert/IslandHistoryBatch.kt tests/island-native/IslandHistoryBatchHarness.kt
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$Jdk/bin/java.exe" -cp $classpath IslandHistoryBatchHarnessKt
exit $LASTEXITCODE
