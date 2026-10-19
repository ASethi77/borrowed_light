"""Check shipped assets and execute the WASM codec extracted from the actual VSIX."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('vsix', type=Path)
args = parser.parse_args()
with zipfile.ZipFile(args.vsix) as archive, tempfile.TemporaryDirectory(prefix='borrowed-light-vsix-') as temporary:
    directory = Path(temporary).resolve()
    assert directory.is_relative_to(Path(tempfile.gettempdir()).resolve())
    names = archive.namelist()
    excluded = ('extension/.cache/', 'extension/profiling-results/', 'extension/tools/', 'extension/src/')
    assert not any(name.startswith(excluded) for name in names), 'Development assets leaked into VSIX'
    assert 'extension/dist/profile-job.js' not in names, 'Profiler runtime leaked into VSIX'
    manifest = json.loads((ROOT / 'codec/artifacts.json').read_text())
    for name, digest in manifest['sha256'].items():
        assert hashlib.sha256(archive.read('extension/dist/codec/' + name)).hexdigest() == digest, f'Packaged codec mismatch: {name}'
    for name in names:
        if name == 'extension/dist/thumbnail-worker.js' or name.startswith('extension/dist/codec/'):
            assert (directory / name).resolve().is_relative_to(directory)
            archive.extract(name, directory)
    subprocess.run(['node', str(ROOT / 'tools/verify-packaged-codec.cjs'),
                    str(directory / 'extension/dist/thumbnail-worker.js'),
                    str(ROOT / 'src/test/fixtures/green.png')], check=True)
    print(f'Verified {len(names)} packaged files and extracted portable codec')
