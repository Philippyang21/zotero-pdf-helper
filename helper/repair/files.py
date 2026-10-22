import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def read_json(path, default=None):
    p = Path(path)
    return json.loads(p.read_text(encoding='utf-8-sig')) if p.exists() else default


def verified_copy(source, destination, expected):
    """Publish an immutable, content-addressed backup. Never overwrite a backup."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if digest(destination) != expected:
            raise ValueError('备份路径已被其他内容占用；未替换 PDF')
        return
    fd, temp = tempfile.mkstemp(dir=destination.parent, suffix='.backup-tmp')
    os.close(fd)
    try:
        shutil.copyfile(source, temp)
        if digest(temp) != expected:
            raise ValueError('原始 PDF 在备份时发生变化；未替换')
        with open(temp, 'r+b') as f:
            os.fsync(f.fileno())
        # Single engine instance serializes backup and replacement operations.
        if destination.exists():
            if digest(destination) != expected:
                raise ValueError('备份冲突')
        else:
            os.replace(temp, destination)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def replace_file(candidate, target, expected):
    """Same-directory staging makes final rename atomic, including across volumes."""
    target = Path(target)
    fd, temp = tempfile.mkstemp(dir=target.parent, prefix='.' + target.name, suffix='.repair-tmp')
    os.close(fd)
    try:
        shutil.copyfile(candidate, temp)
        with open(temp, 'r+b') as f:
            os.fsync(f.fileno())
        if digest(target) != expected:
            raise ValueError('原 PDF 已被其他程序修改，已停止替换')
        os.replace(temp, target)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
