# Native decoder fixtures

`green.png`, `green.bmp`, and `green.heic` are original generated 16×16 still images filled with RGB `(34, 153, 68)` (`#229944`). They contain no third-party artwork. PNG/BMP were written with Pillow; HEIC was encoded with libheif's HEVC encoder at quality 95. The HEIC test allows small compression/color-conversion differences.

Fixtures are test inputs only; they are excluded from the VSIX with the rest of `src/`. Runtime decoding uses built-in Windows/macOS capabilities and does not require these generation tools.
