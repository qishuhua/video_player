#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <math.h>
#include <errno.h>
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/imgutils.h>
#include <libavutil/error.h>
#include <libswscale/swscale.h>

static AVFormatContext *fmt;
static AVCodecContext *dec;
static AVPacket *pkt;
static AVFrame *frame, *converted;
static struct SwsContext *sws;
static uint8_t *pixels;
static unsigned capacity;
static int stream_id, pending, draining, width, height, size, full, bt709;
static double pts, duration, origin, fallback_step, next_pts;
static char error[256];

static int fail(int code) {
    av_strerror(code, error, sizeof(error));
    return -1;
}
const char *decoder_error(void) { return error; }
void decoder_close(void) {
    av_packet_free(&pkt);
    av_frame_free(&frame);
    av_frame_free(&converted);
    avcodec_free_context(&dec);
    avformat_close_input(&fmt);
    sws_freeContext(sws); sws = NULL;
    av_freep(&pixels); capacity = 0;
    pending = draining = size = width = height = 0;
}
int decoder_open(void) {
    decoder_close();
    int r = avformat_open_input(&fmt, "/input.mp4", NULL, NULL);
    if (r < 0) goto bad;
    if ((r = avformat_find_stream_info(fmt, NULL)) < 0) goto bad;
    if ((r = av_find_best_stream(fmt, AVMEDIA_TYPE_VIDEO, -1, -1, NULL, 0)) < 0) goto bad;
    stream_id = r;
    AVStream *st = fmt->streams[stream_id];
    if (st->codecpar->codec_id != AV_CODEC_ID_HEVC && st->codecpar->codec_id != AV_CODEC_ID_H264) {
        r = AVERROR_DECODER_NOT_FOUND; goto bad;
    }
    const AVCodec *codec = avcodec_find_decoder(st->codecpar->codec_id);
    if (!codec) { r = AVERROR_DECODER_NOT_FOUND; goto bad; }
    dec = avcodec_alloc_context3(codec);
    pkt = av_packet_alloc();
    frame = av_frame_alloc();
    converted = av_frame_alloc();
    if (!dec || !pkt || !frame || !converted) { r = AVERROR(ENOMEM); goto bad; }
    if ((r = avcodec_parameters_to_context(dec, st->codecpar)) < 0) goto bad;
    dec->thread_count = 1;
    dec->max_pixels = 4096LL * 2304;
    if ((r = avcodec_open2(dec, codec, NULL)) < 0) goto bad;
    origin = st->start_time == AV_NOPTS_VALUE ? 0 : st->start_time * av_q2d(st->time_base);
    duration = st->duration != AV_NOPTS_VALUE ? st->duration * av_q2d(st->time_base) :
        (fmt->duration == AV_NOPTS_VALUE ? 0 : fmt->duration / (double)AV_TIME_BASE);
    double fps = av_q2d(av_guess_frame_rate(fmt, st, NULL));
    fallback_step = fps > 0 && isfinite(fps) ? 1.0 / fps : 0.04;
    next_pts = 0; pts = 0; error[0] = 0;
    return 0;
bad:
    fail(r); decoder_close(); return -1;
}
static int output_frame(void) {
    width = frame->width; height = frame->height;
    if (width <= 0 || height <= 0 || (int64_t)width * height > 4096LL * 2304)
        return fail(AVERROR(EINVAL));
    AVFrame *src = frame;
    full = frame->color_range == AVCOL_RANGE_JPEG || frame->format == AV_PIX_FMT_YUVJ420P;
    bt709 = frame->colorspace == AVCOL_SPC_BT709 ||
        (frame->colorspace == AVCOL_SPC_UNSPECIFIED && height >= 720);
    if (frame->format != AV_PIX_FMT_YUV420P && frame->format != AV_PIX_FMT_YUVJ420P) {
        sws = sws_getCachedContext(sws, width, height, frame->format, width, height,
                                  AV_PIX_FMT_YUV420P, SWS_BILINEAR, NULL, NULL, NULL);
        if (!sws) return fail(AVERROR(EINVAL));
        const int *coeff = sws_getCoefficients(bt709 ? SWS_CS_ITU709 : SWS_CS_ITU601);
        if (sws_setColorspaceDetails(sws, coeff, full, coeff, full, 0, 1<<16, 1<<16) < 0)
            return fail(AVERROR(EINVAL));
        av_frame_unref(converted);
        converted->format = AV_PIX_FMT_YUV420P;
        converted->width = width; converted->height = height;
        int r = av_frame_get_buffer(converted, 32);
        if (r < 0) return fail(r);
        if (sws_scale(sws, (const uint8_t * const*)frame->data, frame->linesize,
                      0, height, converted->data, converted->linesize) != height)
            return fail(AVERROR(EINVAL));
        src = converted;
    }
    size = av_image_get_buffer_size(AV_PIX_FMT_YUV420P, width, height, 1);
    if (size < 0) return fail(size);
    av_fast_malloc(&pixels, &capacity, size);
    if (!pixels) return fail(AVERROR(ENOMEM));
    int r = av_image_copy_to_buffer(pixels, size, (const uint8_t * const*)src->data,
                                    src->linesize, AV_PIX_FMT_YUV420P, width, height, 1);
    if (r < 0) return fail(r);
    int64_t ts = frame->best_effort_timestamp;
    pts = ts == AV_NOPTS_VALUE ? next_pts :
          fmax(0, ts * av_q2d(fmt->streams[stream_id]->time_base) - origin);
    next_pts = pts + fallback_step;
    av_frame_unref(frame);
    return 1;
}
/* 1 = frame, 0 = EOF, -1 = error. Receive before sending; drain at EOF. */
int decoder_next(void) {
    if (!dec) return fail(AVERROR(EINVAL));
    for (;;) {
        int r = avcodec_receive_frame(dec, frame);
        if (r == 0) return output_frame();
        if (r == AVERROR_EOF) return 0;
        if (r != AVERROR(EAGAIN)) return fail(r);
        if (draining) return fail(AVERROR(EINVAL));
        if (!pending) {
            for (;;) {
                r = av_read_frame(fmt, pkt);
                if (r == AVERROR_EOF) {
                    r = avcodec_send_packet(dec, NULL);
                    if (r < 0 && r != AVERROR_EOF) return fail(r);
                    draining = 1; break;
                }
                if (r < 0) return fail(r);
                if (pkt->stream_index == stream_id) { pending = 1; break; }
                av_packet_unref(pkt);
            }
        }
        if (pending) {
            r = avcodec_send_packet(dec, pkt);
            if (r < 0) return fail(r); /* send/receive cannot both return EAGAIN */
            pending = 0; av_packet_unref(pkt);
        }
    }
}
int decoder_seek(double seconds) {
    if (!dec || !isfinite(seconds) || seconds < 0) return fail(AVERROR(EINVAL));
    int64_t ts = (int64_t)((seconds + origin) / av_q2d(fmt->streams[stream_id]->time_base));
    int r = av_seek_frame(fmt, stream_id, ts, AVSEEK_FLAG_BACKWARD);
    if (r < 0) return fail(r);
    avcodec_flush_buffers(dec); av_packet_unref(pkt); av_frame_unref(frame);
    pending = draining = 0; next_pts = seconds;
    return 0;
}
uint8_t *decoder_pixels(void) { return pixels; }
int decoder_size(void) { return size; }
int decoder_width(void) { return width; }
int decoder_height(void) { return height; }
int decoder_full(void) { return full; }
int decoder_bt709(void) { return bt709; }
double decoder_pts(void) { return pts; }
double decoder_duration(void) { return duration; }
