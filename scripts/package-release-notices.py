"""Build the companion source/notice archive distributed alongside an APK."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
data = json.loads((root / 'assets/legal/third-party-notices.json').read_text(encoding='utf-8'))
source = json.loads((root / 'docs/licenses/source/manifest.json').read_text(encoding='utf-8'))
source_file = root / 'docs/licenses/source' / source['archive']
if hashlib.sha256(source_file.read_bytes()).hexdigest() != source['sha256']:
    raise SystemExit('Source archive SHA-256 mismatch')
args.output.mkdir(parents=True, exist_ok=True)
target = args.output / 'third-party-sources-notices.zip'
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    def write(name, raw):
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, raw)
    for name in ['THIRD_PARTY_LICENSES.md', 'docs/licenses/README.md', 'docs/data-rights.md',
                 'docs/licenses/source/manifest.json', 'docs/licenses/android-runtime-inventory.json']:
        write(name, (root / name).read_bytes())
    write('source/' + source_file.name, source_file.read_bytes())
    write('components.json', json.dumps(data['entries'], ensure_ascii=False, indent=2).encode('utf-8'))
    for key, text in sorted(data['texts'].items()):
        write('texts/' + key + '.txt', text.encode('utf-8'))
checksum = hashlib.sha256(target.read_bytes()).hexdigest()
(args.output / 'THIRD_PARTY_SHA256SUMS').write_text(f'{checksum}  {target.name}\n', encoding='ascii')
print(f'Packaged {len(data["entries"])} component notices and corresponding upstream source.')
