export const MAX_JSON_BODY_BYTES = 1024 * 1024;
export const MAX_AUDIO_BODY_BYTES = 25 * 1024 * 1024;

/** Content type -> filename extension accepted by the transcription route. */
export const AUDIO_CONTENT_TYPES = new Map<string, string>([
  ["audio/webm", "webm"],
  ["video/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/mp4", "m4a"],
  ["video/mp4", "m4a"],
  ["audio/m4a", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/flac", "flac"],
  ["audio/x-flac", "flac"],
]);
