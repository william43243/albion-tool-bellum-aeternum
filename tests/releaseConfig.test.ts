import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const appJson = JSON.parse(readFileSync('app.json', 'utf8'));
const buildGradle = readFileSync('android/app/build.gradle', 'utf8');
const gradleProperties = readFileSync('android/gradle.properties', 'utf8');
// Normalize checkout line endings without changing the shell content asserted below.
const releaseWorkflow = readFileSync('.github/workflows/build-apk.yml', 'utf8').replace(/\r\n/g, '\n');

test('Android SDK is explicitly provisioned in both build and isolated signing jobs', () => {
  const [buildJob, signingJobs] = releaseWorkflow.split(/^  sign:/m);
  const setup = /android-actions\/setup-android@9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407/g;
  assert.equal([...buildJob.matchAll(setup)].length, 1);
  assert.equal([...(signingJobs ?? '').matchAll(setup)].length, 1);
  assert.equal([...releaseWorkflow.matchAll(/packages: 'platform-tools'/g)].length, 2);
  assert.match(buildJob, /platforms;android-37\.0/);
  assert.doesNotMatch(buildJob, /platforms;android-37"/);
});

function requiredMatch(input: string, expression: RegExp, label: string): string {
  const match = input.match(expression);
  assert.ok(match, `${label} must be declared`);
  return match[1];
}

test('release version names and codes stay synchronized', () => {
  const nativeApplicationId = requiredMatch(buildGradle, /^\s*applicationId\s+["']([^"']+)["']\s*$/m, 'Gradle applicationId');
  const nativeVersionName = requiredMatch(buildGradle, /^\s*versionName\s+["']([^"']+)["']\s*$/m, 'Gradle versionName');
  const nativeVersionCode = Number(requiredMatch(buildGradle, /^\s*versionCode\s+(\d+)\s*$/m, 'Gradle versionCode'));

  assert.equal(appJson.expo.android.package, nativeApplicationId);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.equal(appJson.expo.version, packageJson.version);
  assert.equal(nativeVersionName, packageJson.version);
  assert.equal(appJson.expo.android.versionCode, nativeVersionCode);
  assert.equal(packageJson.version, '2.1.0');
  assert.equal(nativeVersionCode, 19);
});

test('release workflow verifies the packaged minimum SDK field emitted by aapt2', () => {
  assert.match(releaseWorkflow, /grep -Fx "minSdkVersion:'24'"/);
  assert.doesNotMatch(releaseWorkflow, /grep -Fx "sdkVersion:'24'"/);
});

test('release architectures are restricted to LiteRT-LM supported 64-bit ABIs', () => {
  const architectures = requiredMatch(
    gradleProperties,
    /^reactNativeArchitectures=([^\r\n]+)$/m,
    'reactNativeArchitectures',
  ).split(',').map((value) => value.trim());

  assert.deepEqual(architectures, ['arm64-v8a', 'x86_64']);
});

test('signed workflow uploads only one exact verified APK from a fresh directory', () => {
  assert.match(releaseWorkflow, /rm -rf "\$output_dir"/);
  assert.match(releaseWorkflow, /mkdir[^\n]*"\$output_dir"/);
  assert.match(releaseWorkflow, /sha256sum -c SHA256SUMS/);
  assert.match(releaseWorkflow, /steps\.sign-release\.outputs\.apk_path/);
  assert.doesNotMatch(releaseWorkflow, /release-candidate\/albion-market-v\*-release\.apk/);
});

test('verified signed artifact uses the versioned stable or prerelease channel', () => {
  assert.match(releaseWorkflow, /publish-release:/);
  assert.match(releaseWorkflow, /needs: verify-signed-artifact/);
  assert.match(releaseWorkflow, /contents: write/);
  assert.match(releaseWorkflow, /gh release create "\$tag"/);
  assert.match(releaseWorkflow, /gh release upload "\$tag"/);
  assert.match(releaseWorkflow, /prerelease=false/);
  assert.match(releaseWorkflow, /latest_args=\(--latest\)/);
  assert.match(releaseWorkflow, /prerelease=true; latest_args=\(--latest=false\)/);
  assert.match(releaseWorkflow, /--notes-file "\$notes_file"/);
  assert.match(releaseWorkflow, /--prerelease="\$prerelease"\s+--draft/);
  assert.match(releaseWorkflow, /gh release edit "\$tag"[^\n]+--draft=false/);
  assert.match(releaseWorkflow, /expected_asset="albion-market-v\$\{version\}-release\.apk"/);
  assert.match(releaseWorkflow, /assets\[\]\?\.name/);
  assert.match(releaseWorkflow, /concurrency:/);
  assert.match(releaseWorkflow, /current_main=.*git\/ref\/heads\/main/);
  assert.match(releaseWorkflow, /release_json=.*lookup_release/);
  assert.match(releaseWorkflow, /gh api --paginate/);
  assert.match(releaseWorkflow, /\.draft == false/);
  assert.match(releaseWorkflow, /\.prerelease == \$prerelease/);
  assert.match(releaseWorkflow, /\.target_commitish == \$sha/);
  assert.match(releaseWorkflow, /git\/ref\/tags\/\$tag/);
  assert.match(releaseWorkflow, /git\/tags\/\$tag_sha/);
  assert.match(releaseWorkflow, /if gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/tags\/\$tag"/);
  assert.match(releaseWorkflow, /curl [^\n]*--fail --location/);
  assert.match(releaseWorkflow, /for asset in "\$expected_asset" SHA256SUMS/);
  assert.match(releaseWorkflow, /cmp -s "\$asset"/);
  assert.doesNotMatch(releaseWorkflow, /gh release upload[^\n]*--clobber/);
});

test('every multiline release shell enables pipefail', () => {
  const blocks = [...releaseWorkflow.matchAll(/run: \|\n((?: {10}.+\n?)+)/g)].map((match) => match[1]);
  assert.ok(blocks.length >= 3);
  for (const block of blocks) assert.match(block, /set -euo pipefail/);
});

test('CI executes native tests and rejects every release APK or AAB from refusal probes', () => {
  assert.match(releaseWorkflow, /cache-dependency-path: package-lock\.json/);
  assert.doesNotMatch(releaseWorkflow, /analytics\/package-lock|npm ci --prefix analytics/);
  assert.match(releaseWorkflow, /:app:testDebugUnitTest/);
  assert.match(releaseWorkflow, /find android\/app\/build\/outputs[^\n]+-name '\*\.apk'[^\n]+-name '\*\.aab'/);
});

test('Gradle cannot access production signing credentials', () => {
  assert.doesNotMatch(buildGradle, /signingConfigs\.release|signingConfig signingConfigs\.release/);
  assert.match(buildGradle, /Gradle must never receive ALBION_UPLOAD_\*/);
});

test('Gradle rejects every ALBION_UPLOAD_ project property during release packaging', () => {
  assert.match(buildGradle, /project\.properties\.keySet\(\)/);
  assert.match(buildGradle, /startsWith\(['"]ALBION_UPLOAD_['"]\)/);
  assert.doesNotMatch(buildGradle, /def signingKeys = \[/);
});

test('CI combines unsigned authorization with each production property and checks clean refusal', () => {
  const refusalProbe = requiredMatch(
    releaseWorkflow,
    /- name: Prove unsigned authorization cannot carry production signing properties\n\s+run: \|\n([\s\S]*?)(?=\n      - name:)/,
    'production-property refusal probe',
  );
  const productionProperties = [
    'ALBION_UPLOAD_KEYSTORE_BASE64',
    'ALBION_UPLOAD_STORE_PASSWORD',
    'ALBION_UPLOAD_KEY_ALIAS',
    'ALBION_UPLOAD_KEY_PASSWORD',
    'ALBION_UPLOAD_CERT_SHA256',
  ];

  for (const property of productionProperties) assert.match(refusalProbe, new RegExp(`\\b${property}\\b`));
  assert.match(refusalProbe, /-PALBION_ALLOW_UNSIGNED_RELEASE=true\s+"-P\$property=probe"/);
  assert.match(refusalProbe, /rm -rf android\/app\/build\/outputs\/apk android\/app\/build\/outputs\/bundle/);
  assert.match(refusalProbe, /left an APK or AAB output after refusal/);
});

test('production secrets remain isolated from the unsigned build job', () => {
  const [buildJob, signingJobs] = releaseWorkflow.split(/^  sign:/m);
  assert.ok(signingJobs, 'sign job must remain separate');
  assert.doesNotMatch(buildJob, /secrets\.ALBION_UPLOAD_/);
  assert.match(signingJobs, /environment: production-signing/);
  assert.match(signingJobs, /secrets\.ALBION_UPLOAD_KEYSTORE_BASE64/);
});
