"""Deterministic, generated artwork; fixture generation is never part of measurements."""
import argparse
import hashlib
import json
from pathlib import Path
import random
import struct
import sys
import zlib

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / '.cache/profiling-python'))
VERSION = 1
SIZES = [(4000,2000), (8000,4000), (7952,5304), (8000,8000), (16000,8000), (16000,16000), (32000,16000)]

def png_chunk(file, kind, data):
    file.write(struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data)))

def png(path, width, height, content):
    if content == 'photo':
        photograph(path, width, height, 'PNG')
        return
    with path.open('wb') as file:
        file.write(b'\x89PNG\r\n\x1a\n')
        png_chunk(file, b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
        compressor = zlib.compressobj(3)
        for y in range(height):
            if content == 'noise':
                row = random.Random(y + 12345).randbytes(width * 4)
            elif content == 'gradient':
                row = bytes(value for x in range(width) for value in (x * 255 // width, y * 255 // height, 80, 255))
            elif content == 'alpha':
                row = bytes([34,153,68,128]) * width
            else:
                row = bytes([34,153,68,255]) * width
            compressed = compressor.compress(b'\0' + row)
            if compressed:
                png_chunk(file, b'IDAT', compressed)
        png_chunk(file, b'IDAT', compressor.flush())
        png_chunk(file, b'IEND', b'')

def jpeg(path, width, height, content, progressive):
    if content == 'photo':
        photograph(path, width, height, 'JPEG', progressive)
        return
    from PIL import Image, ImageFile
    image = Image.new('RGB', (width, height), (34,153,68))
    if content in ('gradient', 'noise'):
        for y in range(height):
            row = (random.Random(y + 12345).randbytes(width * 3) if content == 'noise' else
                   bytes(value for x in range(width) for value in (x * 255 // width, y * 255 // height, 80)))
            image.paste(Image.frombytes('RGB', (width, 1), row), (0,y))
    # Pillow's default progressive output buffer can be smaller than high-entropy
    # 4:4:4 JPEG output. This allocation belongs to generation, outside profiling.
    old_block = ImageFile.MAXBLOCK
    if progressive and content == 'noise':
        ImageFile.MAXBLOCK = max(old_block, width * height * 4 + 65536)
    try:
        image.save(path, format='JPEG', quality=85, progressive=progressive, subsampling=0 if progressive else 2)
    finally:
        ImageFile.MAXBLOCK = old_block
    image.close()

def photograph(path, width, height, format, progressive=False):
    from PIL import Image
    source = ROOT / 'src/test/fixtures/astronaut.png'
    if hashlib.sha256(source.read_bytes()).hexdigest() != '88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5':
        raise RuntimeError('Photographic fixture checksum mismatch')
    with Image.open(source) as original:
        image = original.convert('RGB').resize((width,height), Image.Resampling.BICUBIC)
        options = {'quality':85,'progressive':progressive,'subsampling':0 if progressive else 2} if format == 'JPEG' else {'compress_level':3}
        image.save(path, format=format, **options)
        image.close()

def generate(suite, directory):
    directory.mkdir(parents=True, exist_ok=True)
    # Pairwise coverage: all sizes/formats, expensive content variants at selected sizes.
    sizes = SIZES if suite == 'full' else [SIZES[2], SIZES[5], SIZES[6]]
    cases = [(w,h,fmt,'flat') for w,h in sizes for fmt in ('png','jpeg')]
    cases += [(7952,5304,'progressive','flat'), (4000,2000,'png','alpha')]
    cases += [(4000,2000,fmt,'photo') for fmt in ('png','jpeg')]
    if suite == 'full':
        cases += [(w,h,'progressive','flat') for w,h in SIZES if (w,h) != (7952,5304)]
        cases += [(w,h,fmt,kind) for w,h in [SIZES[0], SIZES[3]] for fmt in ('png','jpeg','progressive') for kind in ('noise','gradient')]
        cases += [(65500,16,'png','flat'), (16,65500,'jpeg','flat')]
        cases += [(7952,5304,fmt,'photo') for fmt in ('png','jpeg')]
        cases += [(16000,8000,'progressive','photo')]
    manifest = []
    for width,height,fmt,content in cases:
        name = f'v{VERSION}-{width}x{height}-{content}-{fmt}'
        path = directory / f'{name}.{"png" if fmt == "png" else "jpg"}'
        if not path.exists():
            print(f'Generating {name}', flush=True)
            temporary = path.with_suffix(path.suffix + '.tmp')
            if fmt == 'png':
                png(temporary, width, height, content)
            else:
                jpeg(temporary, width, height, content, fmt == 'progressive')
            temporary.replace(path)
        with path.open('rb') as file:
            digest = hashlib.file_digest(file, 'sha256').hexdigest()
        manifest.append({'id': name, 'path': str(path.resolve()), 'width': width, 'height': height,
                         'format': fmt, 'content': content, 'bytes': path.stat().st_size,
                         'sha256': digest})
    (directory / f'{suite}.json').write_text(json.dumps({'version': VERSION, 'cases': manifest}, indent=2) + '\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--suite', choices=['smoke','full'], default='smoke')
    parser.add_argument('--directory', type=Path, default=ROOT / '.cache/image-fixtures')
    args = parser.parse_args()
    generate(args.suite, args.directory)
