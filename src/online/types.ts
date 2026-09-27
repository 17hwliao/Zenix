import type { Track } from '../core/types';

export interface OnlineTrack extends Track {
  source: 'online';
  providerId: 'netease';
  remoteId: string;
  availability: 'playable' | 'unavailable';
}

export interface OnlineSearchPage {
  tracks: OnlineTrack[];
  total: number;
  nextOffset: number;
  hasMore: boolean;
}

export interface OnlineAudioSource {
  audioUrl: string | null;
  previewSeconds?: number;
  unavailableReason?: string;
}

export interface OnlineLyrics {
  text: string;
  translationText?: string;
  wordByWordText?: string;
  romanizationText?: string;
}

export interface OnlineBridge {
  search(query: string, offset: number, limit: number): Promise<OnlineSearchPage>;
  resolve(remoteId: string): Promise<OnlineAudioSource>;
  lyrics(remoteId: string): Promise<OnlineLyrics>;
}
