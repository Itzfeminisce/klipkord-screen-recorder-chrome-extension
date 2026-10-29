import { videoStore } from '@/lib/videoStore';
import { SAMPLE_RATE, resample, toMono } from './chunker';

/** Decodes a recording's saved voice track to 16 kHz mono. */
export async function readVoice(recordingId: string): Promise<Float32Array> {
  const blob = await videoStore.read(recordingId, 'voice');
  if (!blob.size) return new Float32Array(0);
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  return resample(toMono(channels), audio.sampleRate, SAMPLE_RATE);
}
