"""Rebuild the bundled, OS-independent thumbnail codec (Python 3.13+, CMake, Ninja, Emscripten 4.0.20)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
SOURCES = {
    'jpeg': ('libjpeg-turbo/libjpeg-turbo', 'c85e6b905bf237038faa936dab160ebfc5da0344'),
    'png': ('pnggroup/libpng', 'cd952f49f95bb27154ae77dbb103032d95f6e580'),
    'zlib': ('madler/zlib', 'da607da739fa6047df13e66a2af6b8bec7c2a498'),
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--emsdk', default=os.environ.get('EMSDK', str(ROOT / '.cache/emsdk')))
    args = parser.parse_args()
    emsdk = Path(args.emsdk).resolve()
    emscripten = emsdk / 'upstream/emscripten'
    python = str(emsdk / 'python/3.13.3_64bit/python.exe') if os.name == 'nt' else 'python3'
    env = dict(os.environ, EM_CONFIG=str(emsdk / '.emscripten'), EMSDK=str(emsdk))
    cache = ROOT / '.cache/thumbnail'
    cache.mkdir(parents=True, exist_ok=True)
    manifest_path = ROOT / 'codec/sources.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for name, (repo, commit) in SOURCES.items():
        archive = cache / f'{name}-{commit}.tgz'
        if not archive.exists():
            print(f'Downloading pinned {name} source', flush=True)
            urllib.request.urlretrieve(f'https://codeload.github.com/{repo}/tar.gz/{commit}', archive)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        if name in manifest and manifest[name]['sha256'] != digest:
            raise RuntimeError(f'{name} source checksum mismatch')
        manifest[name] = {'repository': repo, 'commit': commit, 'sha256': digest}
        source = cache / name
        if not source.exists():
            with tarfile.open(archive) as tar:
                prefix = tar.getmembers()[0].name.split('/')[0]
                tar.extractall(cache / f'extract-{name}', filter='data')
            shutil.move(str(cache / f'extract-{name}' / prefix), source)
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
    def run(command):
        subprocess.run([str(value) for value in command], cwd=ROOT, env=env, check=True)
    build = cache / 'jpeg-build'
    run(['cmake', '-S', cache / 'jpeg', '-B', build, '-G', 'Ninja',
         f'-DCMAKE_TOOLCHAIN_FILE={emscripten}/cmake/Modules/Platform/Emscripten.cmake',
         '-DCMAKE_BUILD_TYPE=Release', '-DBUILD=20260630', '-DENABLE_SHARED=OFF', '-DENABLE_STATIC=ON',
         '-DWITH_SIMD=OFF', '-DWITH_TURBOJPEG=OFF', '-DWITH_TOOLS=OFF', '-DWITH_TESTS=OFF'])
    run(['cmake', '--build', build, '--target', 'jpeg-static', '--parallel', '4'])
    shutil.copyfile(cache / 'png/scripts/pnglibconf.h.prebuilt', cache / 'png/pnglibconf.h')
    png_files = ['png', 'pngerror', 'pngget', 'pngmem', 'pngpread', 'pngread', 'pngrio', 'pngrtran', 'pngrutil', 'pngset', 'pngtrans']
    zlib_files = ['adler32', 'crc32', 'inflate', 'inftrees', 'inffast', 'zutil']
    output = ROOT / 'codec/thumbnail.cjs'
    run([python, emscripten / 'emcc.py', ROOT / 'codec/thumbnail.c', build / 'libjpeg.a',
         *[cache / f'png/{name}.c' for name in png_files], *[cache / f'zlib/{name}.c' for name in zlib_files],
         '-I' + str(build), '-I' + str(cache / 'jpeg/src'), '-I' + str(cache / 'png'), '-I' + str(cache / 'zlib'),
         '-O3', '-sMODULARIZE=1', '-sENVIRONMENT=node', '-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=1',
         '-sMAXIMUM_MEMORY=4294967296', '-sINITIAL_MEMORY=16777216', '-sSTACK_SIZE=1048576', '-sWASM_ASYNC_COMPILATION=0',
         '-sEXPORTED_FUNCTIONS=["_normalize","_result_pixels","_result_width","_result_height","_result_error","_result_orientation"]',
         '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8"]', '-o', output])
    # emcc emits host-specific text newlines and marks WASM executable on Unix.
    # Canonicalize before hashing so Windows and Unix builds match in git.
    output.write_text(output.read_text(encoding='utf-8'), encoding='utf-8', newline='\n')
    for artifact in [output, output.with_suffix('.wasm')]:
        artifact.chmod(0o644)
    licenses = ROOT / 'codec/licenses'
    licenses.mkdir(exist_ok=True)
    license_text = (emscripten / 'LICENSE').read_text(encoding='utf-8')
    (licenses / 'emscripten-LICENSE').write_text('\n'.join(line.rstrip() for line in license_text.splitlines()).rstrip() + '\n', encoding='utf-8', newline='\n')
    for source, candidates in [('jpeg', ['LICENSE.md', 'README.ijg']), ('png', ['LICENSE']), ('zlib', ['LICENSE'])]:
        for candidate in candidates:
            file = cache / source / candidate
            if file.exists():
                shutil.copyfile(file, licenses / f'{source}-{candidate}')
    artifacts = {name: hashlib.sha256((ROOT / 'codec' / name).read_bytes()).hexdigest() for name in ['thumbnail.cjs', 'thumbnail.wasm']}
    (ROOT / 'codec/artifacts.json').write_text(json.dumps({'emscripten': '4.0.20', 'sha256': artifacts}, indent=2) + '\n', encoding='utf-8', newline='\n')

if __name__ == '__main__':
    main()
