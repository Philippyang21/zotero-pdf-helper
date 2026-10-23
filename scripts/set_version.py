"""Set a stable candidate version locally. Does not commit, tag, push or publish."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version')
    args = parser.parse_args()
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', args.version):
        parser.error('Use a stable X.Y.Z version, without v or leading zeros')
    manifest_path = ROOT / 'plugin/manifest.json'
    package_path = ROOT / 'package.json'
    helper_path = ROOT / 'helper/repair/__init__.py'
    feed_path = ROOT / 'release/update-manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf8'))
    feed = json.loads(feed_path.read_text(encoding='utf8'))
    helper = helper_path.read_text(encoding='utf8')
    replacement, count = re.subn(r"__version__ = '[^']+'", f"__version__ = '{args.version}'", helper)
    if count != 1:
        parser.error('Cannot uniquely locate helper version; no files changed')
    if feed.get('published'):
        parser.error('Archive the published feed before starting a new candidate; no files changed')
    manifest['version'] = feed['latestVersion'] = args.version
    feed['minZoteroVersion'] = manifest['applications']['zotero']['strict_min_version']
    feed['maxZoteroVersion'] = manifest['applications']['zotero']['strict_max_version']
    if package_path.exists():
        package = json.loads(package_path.read_text(encoding='utf8'))
        package['version'] = args.version
        package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    helper_path.write_text(replacement, encoding='utf8')
    feed_path.write_text(json.dumps(feed, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print('Candidate updated. Edit CHANGELOG.md, docs/CHANGELOG-' + args.version + '.md and release notes; run check-release.cjs.')


if __name__ == '__main__':
    main()
