"""Collect installed JS and resolved Android runtime notices without publishing local paths.

Regenerate after a release bundle and :app:exportThirdPartyArtifacts. Upstream
supplements are pinned in docs/licenses/supplements.json, never inferred from a
package's name alone. --check verifies the committed bundle against build inputs.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'assets/legal/third-party-notices.json'
MANIFEST = ROOT / 'docs/licenses/android-runtime-inventory.json'
ARTIFACTS = ROOT / 'android/app/build/reports/licenses/artifacts.local.json'
SOURCE_MAP = ROOT / 'android/app/build/intermediates/sourcemaps/react/release/index.android.bundle.packager.map'
CACHE = Path(os.environ.get('GRADLE_USER_HOME', Path.home() / '.gradle')) / 'caches/modules-2/files-2.1'
PREFIXES = ('license', 'licence', 'notice', 'copying', 'copyright', 'third_party_notice', 'third-party-notice')
INPUTS = ['package-lock.json', 'android/app/build.gradle', 'android/build.gradle', 'android/gradle.properties']

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def read_json(p):
    return json.loads(p.read_text(encoding='utf-8'))

def sources(mapping):
    yield from mapping.get('sources', [])
    for section in mapping.get('sections', []):
        yield from sources(section['map'])

def js_packages():
    result = set()
    for source in sources(read_json(SOURCE_MAP)):
        parts = source.replace('\\', '/').split('/')
        positions = [i for i, part in enumerate(parts) if part == 'node_modules']
        if not positions:
            continue
        start, last = positions[0], positions[-1]
        end = last + (3 if parts[last + 1].startswith('@') else 2)
        result.add('/'.join(parts[start:end]))
    return result

def notice_name(name):
    return Path(name).name.lower().startswith(PREFIXES)

def archive_notices(raw, prefix=''):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for name in sorted(archive.namelist()):
            if name.endswith('/'):
                continue
            if notice_name(name):
                yield prefix + name, archive.read(name)
            elif name == 'classes.jar' or (name.startswith('libs/') and name.endswith('.jar')):
                yield from archive_notices(archive.read(name), prefix + name + '!/')

def pom_licenses(group, name, version, seen=None, local=None):
    seen = set() if seen is None else seen
    key = (group, name, version)
    if key in seen:
        return []
    seen.add(key)
    candidates = [local] if local and local.is_file() else sorted((CACHE / group / name / version).glob('*/*.pom'))
    if not candidates:
        return []
    xml = ET.parse(candidates[0]).getroot()
    for elem in xml.iter():
        elem.tag = elem.tag.split('}')[-1]
    licenses = [{'name': p.findtext('name', ''), 'url': p.findtext('url', '')} for p in xml.findall('licenses/license')]
    if licenses:
        return licenses
    parent = xml.find('parent')
    if parent is not None:
        return pom_licenses(*(parent.findtext(p, '') for p in ['groupId', 'artifactId', 'version']), seen)
    return []

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--check-runtime', action='store_true')
    args = parser.parse_args()
    # Git may check out CRLF on Windows and LF in CI; dependency identity is the same.
    inputs = {name: digest((ROOT / name).read_bytes().replace(b'\r\n', b'\n')) for name in INPUTS}
    if args.check or args.check_runtime:
        data, inventory = read_json(OUTPUT), read_json(MANIFEST)
        if inventory['inputs'] != inputs:
            raise RuntimeError('Dependency inputs changed: regenerate third-party notices.')
        for key, body in data['texts'].items():
            if digest(body.encode('utf-8')) != key:
                raise RuntimeError('Notice content hash mismatch')
        for entry in data['entries']:
            for notice in entry['notices']:
                if notice['text'] not in data['texts']:
                    raise RuntimeError('Missing notice text: ' + entry['id'])
        source = read_json(ROOT / 'docs/licenses/source/manifest.json')
        if digest((ROOT / 'docs/licenses/source' / source['archive']).read_bytes()) != source['sha256']:
            raise RuntimeError('Corresponding source archive integrity mismatch')
        if args.check_runtime:
            current = {f"{r['group']}:{r['name']}:{r['version']}" for r in read_json(ARTIFACTS) if r['group'] != 'project'}
            if current != set(inventory['nativeComponents']):
                raise RuntimeError('Resolved native dependencies changed: regenerate notices.')
            if not js_packages().issubset(set(inventory['jsPaths'])):
                raise RuntimeError('New JavaScript runtime package: regenerate notices.')
            entries = {entry['id']: entry for entry in data['entries']}
            for row in read_json(ARTIFACTS):
                if row['group'] != 'project':
                    key = f"{row['group']}:{row['name']}:{row['version']}"
                    if digest(Path(row['file']).read_bytes()) != entries[key]['artifactSha256']:
                        raise RuntimeError('Native artifact changed: ' + key)
        if inventory['unresolved']:
            raise RuntimeError('Unresolved notice coverage: ' + ', '.join(inventory['unresolved']))
        print(f"Verified {len(data['entries'])} components and {len(data['texts'])} notice texts.")
        return

    supplements = read_json(ROOT / 'docs/licenses/supplements.json')
    texts, entries, unresolved = {}, [], []

    def add(entry, label, raw, source):
        body = raw.decode('utf-8-sig', errors='strict').replace('\r\n', '\n')
        key = digest(body.encode('utf-8'))
        texts[key] = body
        entry['notices'].append({'label': label, 'text': key, 'source': source})

    def supplement(entry, key):
        for notice in supplements.get(key, []):
            raw = (ROOT / notice['file']).read_bytes()
            if digest(raw) != notice['sha256']:
                raise RuntimeError('Supplement integrity mismatch: ' + key)
            add(entry, notice.get('label', 'Upstream license'), raw, notice['source'])

    rows = read_json(ARTIFACTS)
    packages = js_packages()
    for row in rows:
        if row['group'] == 'project':
            directory = Path(row['file'])
            while directory != ROOT and ROOT in directory.parents:
                if (directory / 'package.json').is_file():
                    packages.add(directory.relative_to(ROOT).as_posix())
                    break
                directory = directory.parent

    for rel in sorted(packages):
        directory = ROOT / rel
        package = read_json(directory / 'package.json')
        key = f"npm:{package['name']}@{package['version']}"
        entry = {'id': key, 'name': package['name'], 'version': package['version'],
                 'license': package.get('license', 'Unspecified'), 'origin': 'npm', 'notices': []}
        for file in sorted(directory.iterdir()):
            if file.is_file() and notice_name(file.name):
                add(entry, file.name, file.read_bytes(), f"{key}/{file.name}")
        supplement(entry, key)
        if not entry['notices'] or entry['license'] in ('', 'Unspecified', 'UNKNOWN'):
            unresolved.append(key)
        entries.append(entry)

    native = []
    for row in rows:
        if row['group'] == 'project':
            continue
        key = f"{row['group']}:{row['name']}:{row['version']}"
        if key in native:
            continue
        native.append(key)
        artifact = Path(row['file'])
        licenses = pom_licenses(row['group'], row['name'], row['version'], local=artifact.with_suffix('.pom'))
        entry = {'id': key, 'name': f"{row['group']}:{row['name']}", 'version': row['version'],
                 'license': '; '.join(p['name'] for p in licenses) or 'Unspecified',
                 'origin': 'maven', 'declarations': licenses, 'artifactSha256': digest(artifact.read_bytes()), 'notices': []}
        for label, raw in archive_notices(artifact.read_bytes()):
            add(entry, label, raw, f"{key}/{artifact.name}!/{label}")
        # Expo SDK 58 ships local Maven AARs inside the corresponding npm package.
        if ROOT / 'node_modules' in artifact.parents:
            directory = artifact.parent
            while directory != ROOT:
                if (directory / 'package.json').is_file():
                    package = read_json(directory / 'package.json')
                    if not licenses:
                        licenses = [{'name': package.get('license', 'Unspecified'), 'url': ''}]
                        entry['license'] = licenses[0]['name']
                        entry['declarations'] = licenses
                    for file in sorted(directory.iterdir()):
                        if file.is_file() and notice_name(file.name):
                            add(entry, file.name, file.read_bytes(), f"npm:{package['name']}@{package['version']}/{file.name}")
                    supplement(entry, f"npm:{package['name']}@{package['version']}")
                    break
                directory = directory.parent
        supplement(entry, key)
        # The canonical text supplements POM declarations; embedded notices above
        # are always preserved, including each dependency's attribution text.
        if licenses and all('apache' in p['name'].lower() and '2' in p['name'] for p in licenses):
            supplement(entry, 'license:Apache-2.0')
        if not entry['notices'] or not licenses or any(p['name'] in ('', 'Unspecified', 'UNKNOWN') for p in licenses):
            unresolved.append(key)
        entries.append(entry)

    for key in supplements:
        if key.startswith('native-extra:'):
            entry = {'id': key, 'name': key.removeprefix('native-extra:'), 'version': '',
                     'license': 'See upstream notices', 'origin': 'native', 'notices': []}
            supplement(entry, key)
            entries.append(entry)
    data = {'schemaVersion': 1, 'scope': 'Android release JavaScript bundle, native runtime dependencies and native supplements. Downloaded model weights are separate.',
            'entries': sorted(entries, key=lambda e: e['id']), 'texts': texts}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    inventory = {'inputs': inputs, 'jsPaths': sorted(packages), 'nativeComponents': sorted(native), 'unresolved': sorted(unresolved)}
    MANIFEST.write_text(json.dumps(inventory, indent=2) + '\n', encoding='utf-8')
    print(f"Collected {len(entries)} components, {len(texts)} texts; unresolved: {len(unresolved)}")
    for key in unresolved:
        print(key)

if __name__ == '__main__':
    main()
