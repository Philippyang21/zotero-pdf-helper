"""Build with the adopted Zotero Plugin Template toolchain. Never publishes."""
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
node = os.environ.get('PDF_HELPER_NODE') or shutil.which('node')
if not node:
    raise SystemExit('Install Node.js 22.8+ or set PDF_HELPER_NODE; see docs/DEVELOPMENT.md.')
subprocess.run([node, str(ROOT / 'scripts/build-template.cjs')], cwd=ROOT, check=True)
