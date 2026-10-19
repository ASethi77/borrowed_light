# Native decoder fixtures

`astronaut.png` is NASA's public-domain photograph of Eileen Collins, distributed
by [scikit-image](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut).
It was obtained from the pinned [scikit-image v0.25.2 source](https://github.com/scikit-image/scikit-image/blob/v0.25.2/skimage/data/astronaut.png).
SHA-256: `88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5`.
It is used only for codec tests and development resource profiling, and is excluded
from the extension package. Large photographic fixtures are resized derivatives
generated outside the measured workload. Your personal wallpaper is never bundled.

`green.png`, `green.bmp`, and `green.heic` are original generated 16×16 still images filled with RGB `(34, 153, 68)` (`#229944`). They contain no third-party artwork. PNG/BMP were written with Pillow; HEIC was encoded with libheif's HEVC encoder at quality 95. The HEIC test allows small compression/color-conversion differences.

Fixtures are test inputs only; they are excluded from the VSIX with the rest of `src/`. Runtime decoding uses built-in Windows/macOS capabilities and does not require these generation tools.
