import type { PersonalState, Track } from './types';
// The universal module is also required directly by Electron; no runtime evaluation.
// @ts-ignore The build converts the universal CommonJS module to an ES import.
import importedEngine from '../../electron/roaming-engine.cjs';

export type RoamingReason = 'played' | 'skip' | 'failed' | 'dislike';
export type RoamingFeedback = 'liked' | 'favorites' | 'playlist' | 'dislike';
export type RoamingQuery = { key: string; keyword: string };
export interface RoamingState {
  version: 1;
  seen: Record<string, { reason: RoamingReason; at: number }>;
  feedback: Record<string, { score: number; listened: number; plays: number; skips: number; updatedAt: number }>;
  artistAffinity: Record<string, { score: number; updatedAt: number }>;
  recentArtists: string[];
  queryUsage: Record<string, { count: number; lastAt: number }>;
  queryRound: number;
  seedTracks: { track: Pick<Track, 'id' | 'title' | 'artist' | 'album' | 'duration'>; score: number; at: number }[];
}
export interface RoamingEngine {
  identity(track: Track): string;
  createState(): RoamingState;
  queries(state: RoamingState, personal: PersonalState, now?: number): RoamingQuery[];
  rank(state: RoamingState, personal: PersonalState, candidates: Track[], now?: number): Track[];
  consume(state: RoamingState, track: Track, reason: RoamingReason, seconds?: number, duration?: number, now?: number): RoamingState;
  feedback(state: RoamingState, track: Track, kind: RoamingFeedback, now?: number): RoamingState;
  prune(state: RoamingState): RoamingState;
}
export const roamingEngine = importedEngine as RoamingEngine;
export const { identity, createState, queries, rank, consume, feedback, prune } = roamingEngine;
