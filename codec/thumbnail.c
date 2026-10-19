/* Thumbnail adapter only. JPEG/PNG parsing belongs to the pinned upstream codecs. */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <setjmp.h>
#include <jpeglib.h>
#include <jerror.h>
#include <png.h>
#include <emscripten.h>

EM_JS(int, source_read, (unsigned char *target, int length), {
    return Module['readSource'](HEAPU8.subarray(target, target + length));
});
typedef struct { double r, g, b, a, count; } Bin;
static Bin *bins;
static unsigned char *pixels;
static int out_width, out_height, orientation = 1;
static char error_text[512];

static int dimensions(unsigned width, unsigned height, double max_pixels) {
    if (!width || !height || width > 65535 || height > 65535 || (double)width * height > max_pixels) {
        snprintf(error_text, sizeof(error_text), "Wallpaper dimensions exceed configured input limits (%u x %u)", width, height);
        return 0;
    }
    return 1;
}
static int prepare(unsigned width, unsigned height) {
    double scale = width > height ? 1024.0 / width : 1024.0 / height;
    if (scale > 1) scale = 1;
    out_width = (int)(width * scale + 0.5); out_height = (int)(height * scale + 0.5);
    if (out_width < 1) out_width = 1;
    if (out_height < 1) out_height = 1;
    bins = calloc((size_t)out_width * out_height, sizeof(Bin));
    pixels = malloc((size_t)out_width * out_height * 4);
    if (!bins || !pixels) { strcpy(error_text, "Cannot allocate thumbnail buffers"); return 0; }
    return 1;
}
static void sample(unsigned x, unsigned y, unsigned width, unsigned height, int r, int g, int b, int a) {
    unsigned ox = (uint64_t)x * out_width / width, oy = (uint64_t)y * out_height / height;
    Bin *bin = &bins[(size_t)oy * out_width + ox];
    bin->r += r * a; bin->g += g * a; bin->b += b * a; bin->a += a; bin->count++;
}
static void finish(void) {
    for (size_t i = 0; i < (size_t)out_width * out_height; i++) {
        Bin *bin = &bins[i];
        pixels[i * 4] = bin->a ? bin->r / bin->a + 0.5 : 0;
        pixels[i * 4 + 1] = bin->a ? bin->g / bin->a + 0.5 : 0;
        pixels[i * 4 + 2] = bin->a ? bin->b / bin->a + 0.5 : 0;
        pixels[i * 4 + 3] = bin->count ? bin->a / bin->count + 0.5 : 0;
    }
    free(bins); bins = NULL;
}

struct jpeg_errors { struct jpeg_error_mgr base; jmp_buf jump; };
static void jpeg_failure(j_common_ptr info) {
    struct jpeg_errors *errors = (struct jpeg_errors *)info->err;
    (*info->err->format_message)(info, error_text);
    longjmp(errors->jump, 1);
}
static void jpeg_warning(j_common_ptr info, int level) { if (level < 0) jpeg_failure(info); }
struct jpeg_source { struct jpeg_source_mgr base; JOCTET buffer[65536]; };
static void jpeg_noop(j_decompress_ptr info) { (void)info; }
static boolean jpeg_fill(j_decompress_ptr info) {
    struct jpeg_source *source = (struct jpeg_source *)info->src;
    int length = source_read(source->buffer, sizeof(source->buffer));
    if (length <= 0) ERREXIT(info, JERR_INPUT_EOF);
    source->base.next_input_byte = source->buffer; source->base.bytes_in_buffer = length;
    return TRUE;
}
static void jpeg_skip(j_decompress_ptr info, long length) {
    if (length <= 0) return;
    while ((size_t)length > info->src->bytes_in_buffer) {
        length -= info->src->bytes_in_buffer;
        jpeg_fill(info);
    }
    info->src->next_input_byte += length; info->src->bytes_in_buffer -= length;
}
static unsigned exif16(const unsigned char *p, int little) { return little ? p[0] | (p[1] << 8) : (p[0] << 8) | p[1]; }
static uint32_t exif32(const unsigned char *p, int little) {
    return little ? (uint32_t)exif16(p, 1) | ((uint32_t)exif16(p + 2, 1) << 16) : ((uint32_t)exif16(p, 0) << 16) | exif16(p + 2, 0);
}
static void read_orientation(const unsigned char *data, size_t size) {
    if (size < 14 || memcmp(data, "Exif\0\0", 6)) return;
    data += 6; size -= 6;
    int little = data[0] == 'I' && data[1] == 'I';
    if (!little && !(data[0] == 'M' && data[1] == 'M')) return;
    if (exif16(data + 2, little) != 42) return;
    uint32_t offset = exif32(data + 4, little);
    if (offset > size - 2) return;
    unsigned entries = exif16(data + offset, little);
    for (unsigned i = 0; i < entries; i++) {
        size_t at = (size_t)offset + 2 + 12 * i;
        if (at + 12 > size) return;
        if (exif16(data + at, little) == 274 && exif16(data + at + 2, little) == 3 && exif32(data + at + 4, little) == 1) {
            unsigned value = exif16(data + at + 8, little);
            if (value >= 1 && value <= 8) orientation = value;
            return;
        }
    }
}
static int decode_jpeg(double max_pixels) {
    struct jpeg_decompress_struct info;
    struct jpeg_errors errors;
    memset(&info, 0, sizeof(info));
    info.err = jpeg_std_error(&errors.base); errors.base.error_exit = jpeg_failure; errors.base.emit_message = jpeg_warning;
    if (setjmp(errors.jump)) { jpeg_destroy_decompress(&info); return 0; }
    jpeg_create_decompress(&info);
    struct jpeg_source *source = (*info.mem->alloc_small)((j_common_ptr)&info, JPOOL_PERMANENT, sizeof(struct jpeg_source));
    memset(source, 0, sizeof(*source));
    source->base.init_source = jpeg_noop; source->base.fill_input_buffer = jpeg_fill;
    source->base.skip_input_data = jpeg_skip; source->base.resync_to_restart = jpeg_resync_to_restart; source->base.term_source = jpeg_noop;
    info.src = &source->base;
    jpeg_save_markers(&info, JPEG_APP0 + 1, 65535);
    jpeg_read_header(&info, TRUE);
    if (!dimensions(info.image_width, info.image_height, max_pixels)) { jpeg_destroy_decompress(&info); return 0; }
    for (jpeg_saved_marker_ptr marker = info.marker_list; marker; marker = marker->next) read_orientation(marker->data, marker->data_length);
    info.scale_num = 1; info.scale_denom = 1;
    while (info.scale_denom < 8 && (info.image_width / (info.scale_denom * 2) >= 1024 || info.image_height / (info.scale_denom * 2) >= 1024)) info.scale_denom *= 2;
    int cmyk = info.jpeg_color_space == JCS_CMYK || info.jpeg_color_space == JCS_YCCK;
    info.out_color_space = cmyk ? JCS_CMYK : JCS_RGB;
    jpeg_start_decompress(&info);
    if (!prepare(info.output_width, info.output_height)) { jpeg_destroy_decompress(&info); return 0; }
    JSAMPARRAY row = (*info.mem->alloc_sarray)((j_common_ptr)&info, JPOOL_IMAGE, info.output_width * info.output_components, 1);
    while (info.output_scanline < info.output_height) {
        unsigned y = info.output_scanline;
        jpeg_read_scanlines(&info, row, 1);
        for (unsigned x = 0; x < info.output_width; x++) {
            unsigned char *p = row[0] + x * info.output_components;
            int r = p[0], g = p[1], b = p[2];
            if (cmyk) {
                if (info.saw_Adobe_marker) { r = p[0] * p[3] / 255; g = p[1] * p[3] / 255; b = p[2] * p[3] / 255; }
                else { r = (255 - p[0]) * (255 - p[3]) / 255; g = (255 - p[1]) * (255 - p[3]) / 255; b = (255 - p[2]) * (255 - p[3]) / 255; }
            }
            sample(x, y, info.output_width, info.output_height, r, g, b, 255);
        }
    }
    jpeg_finish_decompress(&info); jpeg_destroy_decompress(&info); finish(); return 1;
}

static void png_failure(png_structp png, png_const_charp message) { snprintf(error_text, sizeof(error_text), "PNG: %s", message); png_longjmp(png, 1); }
static void thumbnail_png_warning(png_structp png, png_const_charp message) { (void)png; (void)message; }
static void png_source(png_structp png, png_bytep target, png_size_t length) {
    while (length) {
        int read = source_read(target, length > 65536 ? 65536 : length);
        if (read <= 0) png_error(png, "Truncated PNG");
        target += read; length -= read;
    }
}
static int decode_png(double max_pixels) {
    png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING, NULL, png_failure, thumbnail_png_warning);
    if (!png) { strcpy(error_text, "Cannot allocate PNG decoder"); return 0; }
    png_infop info = png_create_info_struct(png);
    unsigned char *row = NULL;
    if (!info) { png_destroy_read_struct(&png, NULL, NULL); strcpy(error_text, "Cannot allocate PNG metadata"); return 0; }
    if (setjmp(png_jmpbuf(png))) { free(row); png_destroy_read_struct(&png, &info, NULL); return 0; }
    png_set_read_fn(png, NULL, png_source);
    png_set_user_limits(png, 65535, 65535);
    png_set_chunk_malloc_max(png, 16 * 1024 * 1024);
    png_set_crc_action(png, PNG_CRC_ERROR_QUIT, PNG_CRC_ERROR_QUIT);
    png_read_info(png, info);
    unsigned width = png_get_image_width(png, info), height = png_get_image_height(png, info);
    if (!dimensions(width, height, max_pixels)) { png_destroy_read_struct(&png, &info, NULL); return 0; }
    int type = png_get_color_type(png, info), depth = png_get_bit_depth(png, info);
    if (depth == 16) png_set_strip_16(png);
    if (type == PNG_COLOR_TYPE_PALETTE) png_set_palette_to_rgb(png);
    if (type == PNG_COLOR_TYPE_GRAY && depth < 8) png_set_expand_gray_1_2_4_to_8(png);
    int transparent = png_get_valid(png, info, PNG_INFO_tRNS);
    if (transparent) png_set_tRNS_to_alpha(png);
    if (type == PNG_COLOR_TYPE_GRAY || type == PNG_COLOR_TYPE_GRAY_ALPHA) png_set_gray_to_rgb(png);
    if (!(type & PNG_COLOR_MASK_ALPHA) && !transparent) png_set_add_alpha(png, 255, PNG_FILLER_AFTER);
    int passes = png_set_interlace_handling(png);
    png_read_update_info(png, info);
    if (!prepare(width, height)) { png_destroy_read_struct(&png, &info, NULL); return 0; }
    size_t row_bytes = png_get_rowbytes(png, info);
    row = malloc(row_bytes);
    if (!row) png_error(png, "Cannot allocate PNG row");
    const unsigned xs[] = {0,4,0,2,0,1,0}, ys[] = {0,0,4,0,2,0,1}, dx[] = {8,8,4,4,2,2,1}, dy[] = {8,8,8,4,4,2,2};
    for (int pass = 0; pass < passes; pass++) {
        for (unsigned y = 0; y < height; y++) {
            memset(row, 0, row_bytes);
            png_read_row(png, row, NULL);
            if (passes > 1 && (y < ys[pass] || (y - ys[pass]) % dy[pass])) continue;
            for (unsigned x = passes > 1 ? xs[pass] : 0; x < width; x += passes > 1 ? dx[pass] : 1) {
                unsigned char *p = row + x * 4;
                sample(x, y, width, height, p[0], p[1], p[2], p[3]);
            }
        }
    }
    png_read_end(png, info); free(row); png_destroy_read_struct(&png, &info, NULL); finish(); return 1;
}
int normalize(int format, double max_pixels) {
    if (max_pixels < 1000000 || max_pixels > 512000000) { strcpy(error_text, "Invalid image pixel limit"); return 0; }
    return format == 1 ? decode_jpeg(max_pixels) : decode_png(max_pixels);
}
unsigned char *result_pixels(void) { return pixels; }
int result_width(void) { return out_width; }
int result_height(void) { return out_height; }
int result_orientation(void) { return orientation; }
char *result_error(void) { return error_text; }
