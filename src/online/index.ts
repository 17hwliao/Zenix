import { parseLyrics } from '../core/lyrics';
import type { LyricLine } from '../core/types';
import type { OnlineBridge, OnlineSearchPage, OnlineTrack } from './types';

export type { OnlineAudioSource, OnlineBridge, OnlineLyrics, OnlineSearchPage, OnlineTrack } from './types';

function bridge(): OnlineBridge {
  const online = (window.yzqxy as typeof window.yzqxy & { online?: OnlineBridge } | undefined)?.online;
  if (!online) throw new Error('在线音乐服务仅在桌面应用中可用');
  return online;
}

export function hasOnlineService(): boolean {
  return Boolean((window.yzqxy as typeof window.yzqxy & { online?: OnlineBridge } | undefined)?.online);
}

export async function searchOnlineTracks(query: string, offset = 0, limit = 30): Promise<OnlineSearchPage> {
  return bridge().search(query, offset, limit);
}

export class OnlineTrackUnavailableError extends Error {
  constructor(message = '这首歌暂时无法播放') {
    super(message);
    this.name = 'OnlineTrackUnavailableError';
  }
}

export async function resolveOnlineTrack(track: OnlineTrack): Promise<OnlineTrack> {
  if (track.availability === 'unavailable') throw new OnlineTrackUnavailableError();
  const source = await bridge().resolve(track.remoteId);
  if (!source.audioUrl) throw new OnlineTrackUnavailableError(source.unavailableReason);
  const previewSeconds = Number(source.previewSeconds);
  return {
    ...track,
    audioUrl: source.audioUrl,
    duration: Number.isFinite(previewSeconds) && previewSeconds > 0
      ? Math.min(track.duration || previewSeconds, previewSeconds)
      : track.duration,
  };
}

export async function loadOnlineLyrics(track: OnlineTrack): Promise<LyricLine[]> {
  const payload = await bridge().lyrics(track.remoteId);
  const text = payload.text || payload.wordByWordText || '';
  if (!text.trim()) return [];
  const format = payload.text ? 'lrc' : 'yrc';
  const lines = parseLyrics(text, format);
  if (!payload.translationText?.trim()) return lines;
  const translated = parseLyrics(payload.translationText, 'lrc');
  for (const line of lines) {
    const match = translated.find((candidate) => Math.abs(candidate.time - line.time) <= 0.5);
    if (match && match.text !== line.text) line.translation = match.text;
  }
  return lines;
}

export function isOnlineTrack(track: { source?: string; id: string }): track is OnlineTrack {
  return track.source === 'online' && track.id.startsWith('netease:');
}
