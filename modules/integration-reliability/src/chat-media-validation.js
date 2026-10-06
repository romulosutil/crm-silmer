import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { promisify } from 'node:util';

import { ClamAvMediaScanner } from './clamav-media-scanner.js';

const execute = promisify(execFile);
export const CHAT_MEDIA_LIMITS = Object.freeze({
  image: 5 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  video: 16 * 1024 * 1024,
});
const SIGNATURE_MAX_AGE = 36 * 3600000;

export class ChatMediaValidationError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super('Media validation failed');
    this.name = 'ChatMediaValidationError';
    this.reason = reason;
    this.code = 'MEDIA_VALIDATION_REJECTED';
  }
}
export class ChatMediaDeclarationError extends Error {
  /** @param {number} statusCode */
  constructor(statusCode) {
    super('Invalid media declaration');
    this.name = 'ChatMediaDeclarationError';
    this.statusCode = statusCode;
    this.code =
      statusCode === 413 ? 'MEDIA_TOO_LARGE' : 'MEDIA_INVALID_DECLARATION';
  }
}

/** @param {{kind: string, origin: string, sizeBytes?: number, caption?: string}} input */
export function validateMediaDeclaration({ kind, origin, sizeBytes, caption }) {
  if (
    !Object.hasOwn(CHAT_MEDIA_LIMITS, kind) ||
    !['attachment', 'recording'].includes(origin) ||
    (origin === 'recording' && kind !== 'audio')
  )
    throw new ChatMediaDeclarationError(422);
  const maxBytes =
    CHAT_MEDIA_LIMITS[/** @type {keyof typeof CHAT_MEDIA_LIMITS} */ (kind)];
  if (
    sizeBytes !== undefined &&
    (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)
  )
    throw new ChatMediaDeclarationError(422);
  if (sizeBytes !== undefined && sizeBytes > maxBytes)
    throw new ChatMediaDeclarationError(413);
  if (
    caption !== undefined &&
    (typeof caption !== 'string' ||
      kind === 'audio' ||
      [...caption].length > 1024)
  )
    throw new ChatMediaDeclarationError(422);
  return { maxBytes, caption: caption ?? '' };
}

/** @param {string} mime @param {string} kind @param {string} origin */
function canonicalMime(mime, kind, origin) {
  if (
    kind === 'audio' &&
    ['audio/x-m4a', 'audio/m4a', 'audio/mp4'].includes(mime)
  )
    return 'audio/mp4';
  if (
    kind === 'audio' &&
    origin === 'recording' &&
    ['video/webm', 'audio/webm'].includes(mime)
  )
    return 'audio/webm';
  return mime;
}

/** @param {string} [reason] @returns {never} */
function reject(reason = 'invalid_format') {
  throw new ChatMediaValidationError(reason);
}

export class ChatMediaValidator {
  #scanner;
  #execute;
  #now;
  /** @param {{scanner?: {scan: (path: string) => Promise<{clean: boolean,detectedMimeType: string,signatureUpdatedAt: Date|string}>}, execFileImpl?: Function, now?: () => Date}} [options] */
  constructor({
    scanner = new ClamAvMediaScanner(),
    execFileImpl = execute,
    now = () => new Date(),
  } = {}) {
    this.#scanner = scanner;
    this.#execute = execFileImpl;
    this.#now = now;
  }

  /** @param {{path: string,kind: string,origin: string,declaredMimeType: string}} input */
  async validate({ path, kind, origin, declaredMimeType }) {
    const { maxBytes } = validateMediaDeclaration({ kind, origin });
    let stats;
    try {
      stats = await lstat(path);
    } catch {
      return reject();
    }
    if (!stats.isFile() || stats.size < 1 || stats.size > maxBytes)
      return reject();
    let scanned;
    try {
      scanned = await this.#scanner.scan(path);
    } catch {
      return reject('scanner_unavailable');
    }
    if (!scanned.clean) return reject('infected');
    const signatureTime = new Date(scanned.signatureUpdatedAt).getTime();
    const age = this.#now().getTime() - signatureTime;
    if (
      !Number.isFinite(signatureTime) ||
      age > SIGNATURE_MAX_AGE ||
      age < -300000
    )
      return reject('stale_signatures');
    const mimeType = canonicalMime(scanned.detectedMimeType, kind, origin);
    const declared = canonicalMime(
      declaredMimeType.split(';')[0].trim().toLowerCase(),
      kind,
      origin,
    );
    const allowed =
      kind === 'image'
        ? ['image/jpeg', 'image/png']
        : kind === 'video'
          ? ['video/mp4']
          : origin === 'recording'
            ? ['audio/webm', 'audio/ogg', 'audio/mp4']
            : ['audio/mpeg', 'audio/ogg', 'audio/mp4'];
    if (!allowed.includes(mimeType) || mimeType !== declared) return reject();
    let probe;
    try {
      const args = [
        '-v',
        'error',
        '-max_alloc',
        '67108864',
        '-probesize',
        '8388608',
        '-analyzeduration',
        '10000000',
        '-protocol_whitelist',
        'file',
      ];
      if (['audio/mp4', 'video/mp4'].includes(mimeType))
        args.push('-enable_drefs', '0', '-use_absolute_path', '0');
      args.push(
        '-show_entries',
        'stream=codec_type,codec_name:stream_disposition=attached_pic:format=format_name,duration',
        '-of',
        'json',
        '-i',
        path,
      );
      probe = JSON.parse(
        String(
          (
            await this.#execute('ffprobe', args, {
              timeout: 10000,
              maxBuffer: 65536,
              windowsHide: true,
            })
          ).stdout,
        ),
      );
    } catch {
      return reject();
    }
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    const audio = streams.filter(
      (/** @type {any} */ stream) => stream.codec_type === 'audio',
    );
    const video = streams.filter(
      (/** @type {any} */ stream) => stream.codec_type === 'video',
    );
    const container = String(probe.format?.format_name ?? '');
    const formats = container.split(',');
    if (
      streams.some(
        (/** @type {any} */ stream) =>
          !['audio', 'video'].includes(stream.codec_type),
      )
    )
      return reject();
    if (kind === 'image') {
      if (
        streams.length !== 1 ||
        video.length !== 1 ||
        video[0].codec_name !== (mimeType === 'image/jpeg' ? 'mjpeg' : 'png')
      )
        return reject();
    } else if (kind === 'video') {
      if (
        !formats.includes('mp4') ||
        video.length !== 1 ||
        video[0].codec_name !== 'h264' ||
        audio.length > 1 ||
        (audio.length === 1 && audio[0].codec_name !== 'aac')
      )
        return reject();
    } else {
      const codec =
        mimeType === 'audio/mpeg'
          ? 'mp3'
          : mimeType === 'audio/mp4'
            ? 'aac'
            : 'opus';
      const format =
        mimeType === 'audio/mpeg'
          ? 'mp3'
          : mimeType === 'audio/mp4'
            ? 'mp4'
            : mimeType === 'audio/webm'
              ? 'webm'
              : 'ogg';
      if (
        video.some(
          (/** @type {any} */ stream) =>
            mimeType !== 'audio/mpeg' ||
            stream.disposition?.attached_pic !== 1 ||
            !['mjpeg', 'png'].includes(stream.codec_name),
        ) ||
        video.length > 1 ||
        audio.length !== 1 ||
        audio[0].codec_name !== codec ||
        !formats.includes(format)
      )
        return reject();
    }
    let duration = kind === 'image' ? null : Number(probe.format?.duration);
    if (origin === 'recording' && !Number.isFinite(duration)) {
      try {
        const args = [
          '-v',
          'error',
          '-nostdin',
          '-threads',
          '1',
          '-max_alloc',
          '67108864',
          '-protocol_whitelist',
          'file',
        ];
        if (mimeType === 'audio/mp4')
          args.push('-enable_drefs', '0', '-use_absolute_path', '0');
        args.push(
          '-i',
          path,
          '-map',
          '0:a:0',
          '-vn',
          '-t',
          '301',
          '-stats_period',
          '10',
          '-progress',
          'pipe:1',
          '-nostats',
          '-f',
          'null',
          '-',
        );
        const { stdout } = await this.#execute('ffmpeg', args, {
          timeout: 30000,
          maxBuffer: 65536,
          windowsHide: true,
        });
        const times = [
          ...String(stdout).matchAll(/^out_time_us=(\d+)$/gmu),
        ].map((match) => Number(match[1]));
        duration = times.length ? Math.max(...times) / 1000000 : NaN;
      } catch {
        return reject();
      }
    }
    if (
      duration !== null &&
      (!Number.isFinite(duration) ||
        duration <= 0 ||
        (origin === 'recording' && duration > 300))
    )
      return reject();
    const digest = createHash('sha256');
    try {
      for await (const bytes of createReadStream(path)) digest.update(bytes);
    } catch {
      return reject();
    }
    return {
      sizeBytes: stats.size,
      sha256: digest.digest('hex'),
      mimeType,
      container,
      audioCodec: audio[0]?.codec_name ?? null,
      videoCodec: video[0]?.codec_name ?? null,
      durationMs: duration === null ? null : Math.round(duration * 1000),
    };
  }
}
