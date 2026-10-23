"""Explicit source distribution rules shared by packaging and archive tests."""
from pathlib import Path

TOP_FILES = {'.gitignore', '.gitattributes', 'README.md', 'LICENSE', 'CHANGELOG.md',
             'requirements.txt', 'build.py', 'package_release.py', 'package.json', 'pnpm-lock.yaml',
             'pnpm-workspace.yaml', 'tsconfig.json', 'zotero-plugin.config.ts'}
TOP_DIRS = {'plugin', 'helper', 'docs', 'tests', 'scripts', 'release', '.github', 'src', 'typings'}
SUFFIXES = {'.js', '.cjs', '.json', '.py', '.md', '.txt', '.xhtml', '.css', '.png', '.ps1', '.yml', '.yaml', '.ts', '.mts'}
EXCLUDED_PARTS = {'work', '__pycache__', '.git', '.pytest_cache', '.venv', 'node_modules', 'python-env', '.scaffold'}


def source_files(root):
    # Traverse only known source directories; never enumerate a browser profile or venv.
    for name in sorted(TOP_FILES):
        file = root / name
        if file.is_file() and not file.is_symlink():
            yield file
    for name in sorted(TOP_DIRS):
        directory = root / name
        if not directory.is_dir() or directory.is_symlink():
            continue
        for file in sorted(directory.rglob('*')):
            relative = file.relative_to(root)
            if (file.is_file() and not file.is_symlink() and
                    not EXCLUDED_PARTS.intersection(relative.parts) and file.suffix in SUFFIXES):
                yield file


def plugin_files(root):
    for file in sorted((root / 'plugin').rglob('*')):
        relative = file.relative_to(root / 'plugin')
        if (file.is_file() and not file.is_symlink() and not EXCLUDED_PARTS.intersection(relative.parts)
                and (file.suffix in {'.js', '.json', '.xhtml', '.css', '.png'} or relative == Path('helper-source.zip'))):
            yield file
