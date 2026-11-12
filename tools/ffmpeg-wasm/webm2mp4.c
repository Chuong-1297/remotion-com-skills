/*
 * webm2mp4: convert a WebM/Matroska/MP4 recording to MP4 (H.264 via libx264 + AAC).
 * Adapted from FFmpeg doc/examples/transcode.c for a single-threaded WebAssembly build
 * used by Flow Studio. Usage: webm2mp4 <in> <out.mp4> [crf=23] [preset=veryfast] [audio_kbps=128]
 */
/*
 * Copyright (c) 2010 Nicolas George
 * Copyright (c) 2011 Stefano Sabatini
 * Copyright (c) 2014 Andrey Utkin
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * @file demuxing, decoding, filtering, encoding and muxing API usage example
 * @example transcode.c
 *
 * Convert input to output file, applying some hard-coded filter-graph on both
 * audio and video streams.
 */

#include <stdio.h>
#include <stdlib.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavfilter/buffersink.h>
#include <libavfilter/buffersrc.h>
#include <libavutil/channel_layout.h>
#include <libavutil/mem.h>
#include <libavutil/opt.h>
#include <libavutil/pixdesc.h>

static AVFormatContext *ifmt_ctx;
static AVFormatContext *ofmt_ctx;
typedef struct FilteringContext {
    AVFilterContext *buffersink_ctx;
    AVFilterContext *buffersrc_ctx;
    AVFilterGraph *filter_graph;

    AVPacket *enc_pkt;
    AVFrame *filtered_frame;
} FilteringContext;
static FilteringContext *filter_ctx;

typedef struct StreamContext {
    AVCodecContext *dec_ctx;
    AVCodecContext *enc_ctx;

    AVFrame *dec_frame;
} StreamContext;
static StreamContext *stream_ctx;
static int *out_index; /* input stream -> output stream, -1 when dropped */
static int opt_crf = 23;
static const char *opt_preset = "veryfast";
static int opt_audio_kbps = 128;
static double last_progress = -1;
static int64_t *last_pts; /* last video pts sent to each encoder (strictly increasing) */

static int open_input_file(const char *filename)
{
    int ret;
    unsigned int i;

    ifmt_ctx = NULL;
    if ((ret = avformat_open_input(&ifmt_ctx, filename, NULL, NULL)) < 0) {
        av_log(NULL, AV_LOG_ERROR, "Cannot open input file\n");
        return ret;
    }

    if ((ret = avformat_find_stream_info(ifmt_ctx, NULL)) < 0) {
        av_log(NULL, AV_LOG_ERROR, "Cannot find stream information\n");
        return ret;
    }

    stream_ctx = av_calloc(ifmt_ctx->nb_streams, sizeof(*stream_ctx));
    if (!stream_ctx)
        return AVERROR(ENOMEM);

    for (i = 0; i < ifmt_ctx->nb_streams; i++) {
        AVStream *stream = ifmt_ctx->streams[i];
        const AVCodec *dec = avcodec_find_decoder(stream->codecpar->codec_id);
        AVCodecContext *codec_ctx;
        if (!dec && stream->codecpar->codec_type != AVMEDIA_TYPE_VIDEO && stream->codecpar->codec_type != AVMEDIA_TYPE_AUDIO) {
            stream_ctx[i].dec_ctx = NULL;
            stream_ctx[i].dec_frame = av_frame_alloc();
            continue;
        }
        if (!dec) {
            av_log(NULL, AV_LOG_ERROR, "Failed to find decoder for stream #%u\n", i);
            return AVERROR_DECODER_NOT_FOUND;
        }
        codec_ctx = avcodec_alloc_context3(dec);
        if (!codec_ctx) {
            av_log(NULL, AV_LOG_ERROR, "Failed to allocate the decoder context for stream #%u\n", i);
            return AVERROR(ENOMEM);
        }
        ret = avcodec_parameters_to_context(codec_ctx, stream->codecpar);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Failed to copy decoder parameters to input decoder context "
                   "for stream #%u\n", i);
            return ret;
        }

        /* Inform the decoder about the timebase for the packet timestamps.
         * This is highly recommended, but not mandatory. */
        codec_ctx->pkt_timebase = stream->time_base;

        /* Re-encode the first video and the first audio stream, drop everything else. */
        if (codec_ctx->codec_type == AVMEDIA_TYPE_VIDEO
                || codec_ctx->codec_type == AVMEDIA_TYPE_AUDIO) {
            if (codec_ctx->codec_type == AVMEDIA_TYPE_VIDEO)
                codec_ctx->framerate = av_guess_frame_rate(ifmt_ctx, stream, NULL);
            /* Open decoder */
            ret = avcodec_open2(codec_ctx, dec, NULL);
            if (ret < 0) {
                av_log(NULL, AV_LOG_ERROR, "Failed to open decoder for stream #%u\n", i);
                return ret;
            }
        }
        stream_ctx[i].dec_ctx = codec_ctx;

        stream_ctx[i].dec_frame = av_frame_alloc();
        if (!stream_ctx[i].dec_frame)
            return AVERROR(ENOMEM);
    }

    if (ifmt_ctx->duration > 0)
        fprintf(stderr, "duration=%.3f\n", ifmt_ctx->duration / (double)AV_TIME_BASE);
    return 0;
}

static int open_output_file(const char *filename)
{
    AVStream *out_stream;
    AVStream *in_stream;
    AVCodecContext *dec_ctx, *enc_ctx;
    const AVCodec *encoder;
    int ret;
    unsigned int i;

    ofmt_ctx = NULL;
    avformat_alloc_output_context2(&ofmt_ctx, NULL, NULL, filename);
    if (!ofmt_ctx) {
        av_log(NULL, AV_LOG_ERROR, "Could not create output context\n");
        return AVERROR_UNKNOWN;
    }


    int have_video = 0, have_audio = 0;
    out_index = av_malloc_array(ifmt_ctx->nb_streams, sizeof(*out_index));
    if (!out_index)
        return AVERROR(ENOMEM);
    for (i = 0; i < ifmt_ctx->nb_streams; i++) {
        out_index[i] = -1;
        dec_ctx = stream_ctx[i].dec_ctx;
        if (!dec_ctx)
            continue;
        if (dec_ctx->codec_type == AVMEDIA_TYPE_VIDEO && !have_video)
            have_video = 1;
        else if (dec_ctx->codec_type == AVMEDIA_TYPE_AUDIO && !have_audio)
            have_audio = 1;
        else
            continue;
        out_stream = avformat_new_stream(ofmt_ctx, NULL);
        out_index[i] = out_stream->index;
        if (!out_stream) {
            av_log(NULL, AV_LOG_ERROR, "Failed allocating output stream\n");
            return AVERROR_UNKNOWN;
        }

        in_stream = ifmt_ctx->streams[i];
        dec_ctx = stream_ctx[i].dec_ctx;

        if (dec_ctx->codec_type == AVMEDIA_TYPE_VIDEO
                || dec_ctx->codec_type == AVMEDIA_TYPE_AUDIO) {
            encoder = dec_ctx->codec_type == AVMEDIA_TYPE_VIDEO
                      ? avcodec_find_encoder_by_name("libx264")
                      : avcodec_find_encoder(AV_CODEC_ID_AAC);
            if (!encoder) {
                av_log(NULL, AV_LOG_FATAL, "Necessary encoder not found\n");
                return AVERROR_INVALIDDATA;
            }
            enc_ctx = avcodec_alloc_context3(encoder);
            if (!enc_ctx) {
                av_log(NULL, AV_LOG_FATAL, "Failed to allocate the encoder context\n");
                return AVERROR(ENOMEM);
            }

            /* In this example, we transcode to same properties (picture size,
             * sample rate etc.). These properties can be changed for output
             * streams easily using filters */
            if (dec_ctx->codec_type == AVMEDIA_TYPE_VIDEO) {
                const enum AVPixelFormat *pix_fmts = NULL;

                /* yuv420p needs even dimensions */
                enc_ctx->height = dec_ctx->height & ~1;
                enc_ctx->width = dec_ctx->width & ~1;
                enc_ctx->sample_aspect_ratio = dec_ctx->sample_aspect_ratio;

                ret = avcodec_get_supported_config(enc_ctx, NULL,
                                                   AV_CODEC_CONFIG_PIX_FORMAT, 0,
                                                   (const void**)&pix_fmts, NULL);

                (void)pix_fmts;
                enc_ctx->pix_fmt = AV_PIX_FMT_YUV420P; /* plays everywhere */

                /* Keep the recording's own timestamps (MediaRecorder output has a variable frame rate). */
                enc_ctx->time_base = dec_ctx->pkt_timebase.num ? dec_ctx->pkt_timebase : (AVRational){1, 1000};
                enc_ctx->framerate = dec_ctx->framerate.num ? dec_ctx->framerate : (AVRational){30, 1};
            } else {
                const enum AVSampleFormat *sample_fmts = NULL;

                enc_ctx->sample_rate = dec_ctx->sample_rate;
                if (dec_ctx->ch_layout.nb_channels > 2 || dec_ctx->ch_layout.nb_channels < 1)
                    av_channel_layout_default(&enc_ctx->ch_layout, 2);
                else
                    av_channel_layout_default(&enc_ctx->ch_layout, dec_ctx->ch_layout.nb_channels);
                enc_ctx->bit_rate = (int64_t)opt_audio_kbps * 1000;

                ret = avcodec_get_supported_config(enc_ctx, NULL,
                                                   AV_CODEC_CONFIG_SAMPLE_FORMAT, 0,
                                                   (const void**)&sample_fmts, NULL);

                /* take first format from list of supported formats */
                enc_ctx->sample_fmt = (ret >= 0 && sample_fmts) ?
                                      sample_fmts[0] : dec_ctx->sample_fmt;

                enc_ctx->time_base = (AVRational){1, enc_ctx->sample_rate};
            }

            if (ofmt_ctx->oformat->flags & AVFMT_GLOBALHEADER)
                enc_ctx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;

            AVDictionary *enc_opts = NULL;
            if (dec_ctx->codec_type == AVMEDIA_TYPE_VIDEO) {
                char crf[16];
                snprintf(crf, sizeof(crf), "%d", opt_crf);
                av_dict_set(&enc_opts, "preset", opt_preset, 0);
                av_dict_set(&enc_opts, "crf", crf, 0);
            }
            ret = avcodec_open2(enc_ctx, encoder, &enc_opts);
            av_dict_free(&enc_opts);
            if (ret < 0) {
                av_log(NULL, AV_LOG_ERROR, "Cannot open %s encoder for stream #%u\n", encoder->name, i);
                return ret;
            }
            ret = avcodec_parameters_from_context(out_stream->codecpar, enc_ctx);
            if (ret < 0) {
                av_log(NULL, AV_LOG_ERROR, "Failed to copy encoder parameters to output stream #%u\n", i);
                return ret;
            }

            out_stream->time_base = enc_ctx->time_base;
            stream_ctx[i].enc_ctx = enc_ctx;
        }
        (void)in_stream;

    }
    if (!have_video && !have_audio) {
        av_log(NULL, AV_LOG_ERROR, "No audio or video stream in the input\n");
        return AVERROR_INVALIDDATA;
    }

    if (!(ofmt_ctx->oformat->flags & AVFMT_NOFILE)) {
        ret = avio_open(&ofmt_ctx->pb, filename, AVIO_FLAG_WRITE);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Could not open output file '%s'", filename);
            return ret;
        }
    }

    /* init muxer, write output file header */
    AVDictionary *mux_opts = NULL;
    av_dict_set(&mux_opts, "movflags", "+faststart", 0);
    ret = avformat_write_header(ofmt_ctx, &mux_opts);
    av_dict_free(&mux_opts);
    if (ret < 0) {
        av_log(NULL, AV_LOG_ERROR, "Error occurred when opening output file\n");
        return ret;
    }

    return 0;
}

static int init_filter(FilteringContext* fctx, AVCodecContext *dec_ctx,
        AVCodecContext *enc_ctx, const char *filter_spec)
{
    char args[512];
    int ret = 0;
    const AVFilter *buffersrc = NULL;
    const AVFilter *buffersink = NULL;
    AVFilterContext *buffersrc_ctx = NULL;
    AVFilterContext *buffersink_ctx = NULL;
    AVFilterInOut *outputs = avfilter_inout_alloc();
    AVFilterInOut *inputs  = avfilter_inout_alloc();
    AVFilterGraph *filter_graph = avfilter_graph_alloc();

    if (!outputs || !inputs || !filter_graph) {
        ret = AVERROR(ENOMEM);
        goto end;
    }

    if (dec_ctx->codec_type == AVMEDIA_TYPE_VIDEO) {
        buffersrc = avfilter_get_by_name("buffer");
        buffersink = avfilter_get_by_name("buffersink");
        if (!buffersrc || !buffersink) {
            av_log(NULL, AV_LOG_ERROR, "filtering source or sink element not found\n");
            ret = AVERROR_UNKNOWN;
            goto end;
        }

        snprintf(args, sizeof(args),
                "video_size=%dx%d:pix_fmt=%d:time_base=%d/%d:pixel_aspect=%d/%d",
                dec_ctx->width, dec_ctx->height, dec_ctx->pix_fmt,
                dec_ctx->pkt_timebase.num, dec_ctx->pkt_timebase.den,
                dec_ctx->sample_aspect_ratio.num,
                dec_ctx->sample_aspect_ratio.den);

        ret = avfilter_graph_create_filter(&buffersrc_ctx, buffersrc, "in",
                args, NULL, filter_graph);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Cannot create buffer source\n");
            goto end;
        }

        buffersink_ctx = avfilter_graph_alloc_filter(filter_graph, buffersink, "out");
        if (!buffersink_ctx) {
            av_log(NULL, AV_LOG_ERROR, "Cannot create buffer sink\n");
            ret = AVERROR(ENOMEM);
            goto end;
        }

        ret = av_opt_set(buffersink_ctx, "pixel_formats",
                av_get_pix_fmt_name(enc_ctx->pix_fmt), AV_OPT_SEARCH_CHILDREN);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Cannot set output pixel format\n");
            goto end;
        }

        ret = avfilter_init_dict(buffersink_ctx, NULL);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Cannot initialize buffer sink\n");
            goto end;
        }
    } else if (dec_ctx->codec_type == AVMEDIA_TYPE_AUDIO) {
        char buf[64];
        buffersrc = avfilter_get_by_name("abuffer");
        buffersink = avfilter_get_by_name("abuffersink");
        if (!buffersrc || !buffersink) {
            av_log(NULL, AV_LOG_ERROR, "filtering source or sink element not found\n");
            ret = AVERROR_UNKNOWN;
            goto end;
        }

        if (dec_ctx->ch_layout.order == AV_CHANNEL_ORDER_UNSPEC)
            av_channel_layout_default(&dec_ctx->ch_layout, dec_ctx->ch_layout.nb_channels);
        av_channel_layout_describe(&dec_ctx->ch_layout, buf, sizeof(buf));
        snprintf(args, sizeof(args),
                "time_base=%d/%d:sample_rate=%d:sample_fmt=%s:channel_layout=%s",
                dec_ctx->pkt_timebase.num, dec_ctx->pkt_timebase.den, dec_ctx->sample_rate,
                av_get_sample_fmt_name(dec_ctx->sample_fmt),
                buf);
        ret = avfilter_graph_create_filter(&buffersrc_ctx, buffersrc, "in",
                args, NULL, filter_graph);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Cannot create audio buffer source\n");
            goto end;
        }

        buffersink_ctx = avfilter_graph_alloc_filter(filter_graph, buffersink, "out");
        if (!buffersink_ctx) {
            av_log(NULL, AV_LOG_ERROR, "Cannot create audio buffer sink\n");
            ret = AVERROR(ENOMEM);
            goto end;
        }

        ret = av_opt_set(buffersink_ctx, "sample_formats",
                av_get_sample_fmt_name(enc_ctx->sample_fmt), AV_OPT_SEARCH_CHILDREN);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Cannot set output sample format\n");
            goto end;
        }

        av_channel_layout_describe(&enc_ctx->ch_layout, buf, sizeof(buf));
        ret = av_opt_set(buffersink_ctx, "channel_layouts",
                         buf, AV_OPT_SEARCH_CHILDREN);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Cannot set output channel layout\n");
            goto end;
        }

        snprintf(buf, sizeof(buf), "%d", enc_ctx->sample_rate);
        ret = av_opt_set(buffersink_ctx, "samplerates", buf, AV_OPT_SEARCH_CHILDREN);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Cannot set output sample rate\n");
            goto end;
        }

        if (enc_ctx->frame_size > 0)
            av_buffersink_set_frame_size(buffersink_ctx, enc_ctx->frame_size);

        ret = avfilter_init_dict(buffersink_ctx, NULL);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Cannot initialize audio buffer sink\n");
            goto end;
        }
    } else {
        ret = AVERROR_UNKNOWN;
        goto end;
    }

    /* Endpoints for the filter graph. */
    outputs->name       = av_strdup("in");
    outputs->filter_ctx = buffersrc_ctx;
    outputs->pad_idx    = 0;
    outputs->next       = NULL;

    inputs->name       = av_strdup("out");
    inputs->filter_ctx = buffersink_ctx;
    inputs->pad_idx    = 0;
    inputs->next       = NULL;

    if (!outputs->name || !inputs->name) {
        ret = AVERROR(ENOMEM);
        goto end;
    }

    if ((ret = avfilter_graph_parse_ptr(filter_graph, filter_spec,
                    &inputs, &outputs, NULL)) < 0)
        goto end;

    if ((ret = avfilter_graph_config(filter_graph, NULL)) < 0)
        goto end;

    /* Fill FilteringContext */
    fctx->buffersrc_ctx = buffersrc_ctx;
    fctx->buffersink_ctx = buffersink_ctx;
    fctx->filter_graph = filter_graph;

end:
    avfilter_inout_free(&inputs);
    avfilter_inout_free(&outputs);

    return ret;
}

static int init_filters(void)
{
    const char *filter_spec;
    unsigned int i;
    int ret;
    filter_ctx = av_malloc_array(ifmt_ctx->nb_streams, sizeof(*filter_ctx));
    if (!filter_ctx)
        return AVERROR(ENOMEM);

    for (i = 0; i < ifmt_ctx->nb_streams; i++) {
        filter_ctx[i].buffersrc_ctx  = NULL;
        filter_ctx[i].buffersink_ctx = NULL;
        filter_ctx[i].filter_graph   = NULL;
        if (out_index[i] < 0)
            continue;


        char scale_spec[64];
        if (ifmt_ctx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_VIDEO) {
            AVCodecContext *e = stream_ctx[i].enc_ctx, *d = stream_ctx[i].dec_ctx;
            if (e->width != d->width || e->height != d->height) {
                snprintf(scale_spec, sizeof(scale_spec), "scale=%d:%d", e->width, e->height);
                filter_spec = scale_spec;
            } else
                filter_spec = "null";
        }
        else
            filter_spec = "anull"; /* passthrough (dummy) filter for audio */
        ret = init_filter(&filter_ctx[i], stream_ctx[i].dec_ctx,
                stream_ctx[i].enc_ctx, filter_spec);
        if (ret)
            return ret;

        filter_ctx[i].enc_pkt = av_packet_alloc();
        if (!filter_ctx[i].enc_pkt)
            return AVERROR(ENOMEM);

        filter_ctx[i].filtered_frame = av_frame_alloc();
        if (!filter_ctx[i].filtered_frame)
            return AVERROR(ENOMEM);
    }
    return 0;
}

static int encode_write_frame(unsigned int stream_index, int flush)
{
    StreamContext *stream = &stream_ctx[stream_index];
    FilteringContext *filter = &filter_ctx[stream_index];
    AVFrame *filt_frame = flush ? NULL : filter->filtered_frame;
    AVPacket *enc_pkt = filter->enc_pkt;
    int ret;

    /* encode filtered frame */
    av_packet_unref(enc_pkt);

    if (filt_frame && filt_frame->pts != AV_NOPTS_VALUE) {
        filt_frame->pts = av_rescale_q(filt_frame->pts, filt_frame->time_base,
                                       stream->enc_ctx->time_base);
        /* MediaRecorder can stamp a repeated frame with the same millisecond: drop it so pts stay strictly increasing */
        if (stream->enc_ctx->codec_type == AVMEDIA_TYPE_VIDEO) {
            if (last_pts[stream_index] != AV_NOPTS_VALUE && filt_frame->pts <= last_pts[stream_index])
                return 0;
            last_pts[stream_index] = filt_frame->pts;
        }
    }

    ret = avcodec_send_frame(stream->enc_ctx, filt_frame);

    if (ret < 0)
        return ret;

    while (ret >= 0) {
        ret = avcodec_receive_packet(stream->enc_ctx, enc_pkt);

        if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF)
            return 0;

        /* prepare packet for muxing */
        enc_pkt->stream_index = out_index[stream_index];
        av_packet_rescale_ts(enc_pkt,
                             stream->enc_ctx->time_base,
                             ofmt_ctx->streams[out_index[stream_index]]->time_base);

        av_log(NULL, AV_LOG_DEBUG, "Muxing frame\n");
        /* mux encoded frame */
        ret = av_interleaved_write_frame(ofmt_ctx, enc_pkt);
    }

    return ret;
}

static int filter_encode_write_frame(AVFrame *frame, unsigned int stream_index)
{
    FilteringContext *filter = &filter_ctx[stream_index];
    int ret;

    av_log(NULL, AV_LOG_INFO, "Pushing decoded frame to filters\n");
    /* push the decoded frame into the filtergraph */
    ret = av_buffersrc_add_frame_flags(filter->buffersrc_ctx,
            frame, 0);
    if (ret < 0) {
        av_log(NULL, AV_LOG_ERROR, "Error while feeding the filtergraph\n");
        return ret;
    }

    /* pull filtered frames from the filtergraph */
    while (1) {
        av_log(NULL, AV_LOG_INFO, "Pulling filtered frame from filters\n");
        ret = av_buffersink_get_frame(filter->buffersink_ctx,
                                      filter->filtered_frame);
        if (ret < 0) {
            /* if no more frames for output - returns AVERROR(EAGAIN)
             * if flushed and no more frames for output - returns AVERROR_EOF
             * rewrite retcode to 0 to show it as normal procedure completion
             */
            if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF)
                ret = 0;
            break;
        }

        filter->filtered_frame->time_base = av_buffersink_get_time_base(filter->buffersink_ctx);;
        filter->filtered_frame->pict_type = AV_PICTURE_TYPE_NONE;
        ret = encode_write_frame(stream_index, 0);
        av_frame_unref(filter->filtered_frame);
        if (ret < 0)
            break;
    }

    return ret;
}

static int flush_encoder(unsigned int stream_index)
{
    if (!(stream_ctx[stream_index].enc_ctx->codec->capabilities &
                AV_CODEC_CAP_DELAY))
        return 0;

    av_log(NULL, AV_LOG_INFO, "Flushing stream #%u encoder\n", stream_index);
    return encode_write_frame(stream_index, 1);
}

int main(int argc, char **argv)
{
    int ret;
    AVPacket *packet = NULL;
    unsigned int stream_index;
    unsigned int i;

    if (argc < 3) {
        fprintf(stderr, "Usage: %s <input> <output.mp4> [crf] [preset] [audio_kbps]\n", argv[0]);
        return 1;
    }
    if (argc > 3) opt_crf = atoi(argv[3]);
    if (argc > 4) opt_preset = argv[4];
    if (argc > 5) opt_audio_kbps = atoi(argv[5]);
    av_log_set_level(AV_LOG_ERROR);

    if ((ret = open_input_file(argv[1])) < 0)
        goto end;
    if ((ret = open_output_file(argv[2])) < 0)
        goto end;
    if ((ret = init_filters()) < 0)
        goto end;
    last_pts = av_malloc_array(ifmt_ctx->nb_streams, sizeof(*last_pts));
    if (!last_pts) { ret = AVERROR(ENOMEM); goto end; }
    for (i = 0; i < ifmt_ctx->nb_streams; i++)
        last_pts[i] = AV_NOPTS_VALUE;
    if (!(packet = av_packet_alloc()))
        goto end;

    /* read all packets */
    while (1) {
        if ((ret = av_read_frame(ifmt_ctx, packet)) < 0)
            break;
        stream_index = packet->stream_index;
        av_log(NULL, AV_LOG_DEBUG, "Demuxer gave frame of stream_index %u\n",
                stream_index);

        if (filter_ctx[stream_index].filter_graph) {
            StreamContext *stream = &stream_ctx[stream_index];
            if (packet->pts != AV_NOPTS_VALUE) {
                double t = packet->pts * av_q2d(ifmt_ctx->streams[stream_index]->time_base);
                if (t - last_progress >= 0.25) {
                    last_progress = t;
                    fprintf(stderr, "progress=%.3f\n", t);
                }
            }

            av_log(NULL, AV_LOG_DEBUG, "Going to reencode&filter the frame\n");

            ret = avcodec_send_packet(stream->dec_ctx, packet);
            if (ret < 0) {
                av_log(NULL, AV_LOG_ERROR, "Decoding failed\n");
                break;
            }

            while (ret >= 0) {
                ret = avcodec_receive_frame(stream->dec_ctx, stream->dec_frame);
                if (ret == AVERROR_EOF || ret == AVERROR(EAGAIN))
                    break;
                else if (ret < 0)
                    goto end;

                stream->dec_frame->pts = stream->dec_frame->best_effort_timestamp;
                ret = filter_encode_write_frame(stream->dec_frame, stream_index);
                if (ret < 0)
                    goto end;
            }
        }
        av_packet_unref(packet);
    }

    /* flush decoders, filters and encoders */
    for (i = 0; i < ifmt_ctx->nb_streams; i++) {
        StreamContext *stream;

        if (!filter_ctx[i].filter_graph)
            continue;

        stream = &stream_ctx[i];

        av_log(NULL, AV_LOG_INFO, "Flushing stream %u decoder\n", i);

        /* flush decoder */
        ret = avcodec_send_packet(stream->dec_ctx, NULL);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Flushing decoding failed\n");
            goto end;
        }

        while (ret >= 0) {
            ret = avcodec_receive_frame(stream->dec_ctx, stream->dec_frame);
            if (ret == AVERROR_EOF)
                break;
            else if (ret < 0)
                goto end;

            stream->dec_frame->pts = stream->dec_frame->best_effort_timestamp;
            ret = filter_encode_write_frame(stream->dec_frame, i);
            if (ret < 0)
                goto end;
        }

        /* flush filter */
        ret = filter_encode_write_frame(NULL, i);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Flushing filter failed\n");
            goto end;
        }

        /* flush encoder */
        ret = flush_encoder(i);
        if (ret < 0) {
            av_log(NULL, AV_LOG_ERROR, "Flushing encoder failed\n");
            goto end;
        }
    }

    av_write_trailer(ofmt_ctx);
    fprintf(stderr, "done\n");
end:
    av_packet_free(&packet);
    for (i = 0; ifmt_ctx && stream_ctx && i < ifmt_ctx->nb_streams; i++) {
        avcodec_free_context(&stream_ctx[i].dec_ctx);
        if (stream_ctx[i].enc_ctx)
            avcodec_free_context(&stream_ctx[i].enc_ctx);
        if (filter_ctx && filter_ctx[i].filter_graph) {
            avfilter_graph_free(&filter_ctx[i].filter_graph);
            av_packet_free(&filter_ctx[i].enc_pkt);
            av_frame_free(&filter_ctx[i].filtered_frame);
        }

        av_frame_free(&stream_ctx[i].dec_frame);
    }
    av_free(filter_ctx);
    av_free(stream_ctx);
    av_free(out_index);
    av_free(last_pts);
    avformat_close_input(&ifmt_ctx);
    if (ofmt_ctx && !(ofmt_ctx->oformat->flags & AVFMT_NOFILE))
        avio_closep(&ofmt_ctx->pb);
    avformat_free_context(ofmt_ctx);

    if (ret < 0)
        av_log(NULL, AV_LOG_ERROR, "Error occurred: %s\n", av_err2str(ret));

    return ret ? 1 : 0;
}
