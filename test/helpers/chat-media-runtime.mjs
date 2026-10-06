// Local isolated Docker test port. No filename, path or binary output is logged.
const base =
  process.env.CHAT_MEDIA_USE_BUILT_RUNTIME === 'yes'
    ? '/app/modules/integration-reliability/src/'
    : '../../modules/integration-reliability/src/';
const { ChatMediaValidator } = await import(base + 'chat-media-validation.js');
const { RecordedAudioNormalizer } = await import(
  base + 'recorded-audio-normalizer.js'
);

const mode = process.argv[2];
const input = JSON.parse(process.argv[3]);
try {
  const result =
    mode === 'validate'
      ? await new ChatMediaValidator().validate(input)
      : await new RecordedAudioNormalizer().normalize(input);
  /** @type {Record<string,any>} */ const metadata = { ...result };
  delete metadata.path;
  process.stdout.write(JSON.stringify(metadata));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      error: 'MEDIA_VALIDATION_REJECTED',
      reason:
        error instanceof Error && 'reason' in error
          ? error.reason
          : 'processing_failed',
    }),
  );
  process.exitCode = 1;
}
