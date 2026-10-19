# Portable thumbnail decoder

The universal VSIX includes `thumbnail.cjs` and `thumbnail.wasm`. These are built from
the small adapter in `thumbnail.c` and the immutable upstream sources recorded in
`sources.json`: libjpeg-turbo 3.2.0, libpng 1.6.59, and zlib 1.3.2. License notices
are in `licenses/`. There is no runtime installation, network access, native Node
addon, system codec dependency, or dependency on glibc/musl.

To rebuild, install Python 3.10+, CMake, Ninja, and Emscripten **4.0.20**, then run:

```sh
python tools/build-thumbnail.py --emsdk /path/to/emsdk
```

Sources are downloaded into `.cache/thumbnail` and checked against their SHA-256
digests before compilation. The build updates `artifacts.json`; normal extension
builds verify those artifact hashes and copy assets to `dist/codec`. An upstream
upgrade requires updating the pinned commit and reviewing the corresponding source
digest and licenses. CI rebuilds the module and runs its decoder tests.

JPEG decoding uses reduced IDCT output and scanlines. PNG decoding processes rows
and Adam7 passes; pixels are accumulated into bounded, opacity-weighted thumbnail
bins. It never allocates a source-size RGBA image. Progressive JPEG still needs
source-size coefficient arrays inside libjpeg. WASM can grow to 4 GiB; that is an
address-space ceiling, not a promise of available memory or a process RSS cap.
Each job has its own worker and WASM instance, released when the job ends.

Portable samples are treated as sRGB; embedded ICC profiles are not converted.
Native paths may color-manage images differently. Pixel-limit parity does not
promise identical palettes for color-profiled sources.
