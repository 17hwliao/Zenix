# Zenix UI refresh and LAN karaoke boundary

This change keeps the existing player, personal library and update pipeline as downstream consumers. It does not change package identity, build numbers or release metadata.

## Feature ownership

- Music-space display owns the versioned `sticker | list` preference, first-use onboarding and migration from `orbit` to `sticker`. It may update only feature-space state, presentation hosts and their tests.
- Visual themes own the versioned local theme package, whitelist parser, built-in themes and pure-lyrics presentation. Theme failures fall back to the default theme without changing queue or lyric data.
- Karaoke core owns immutable song/lyric/pitch/accompaniment descriptors and pure scoring. It never writes ordinary playback or personal-library state.
- Karaoke LAN owns host-authoritative room state, six-digit code confirmation, independent room grants, reconnect state and media signaling. A K-song failure must leave ordinary playback untouched.

## Persistence

Every local setting uses a versioned schema and atomic replacement. Unknown or corrupt values are reported without overwriting the original bytes. Repeated migrations are idempotent.

## Failure isolation

- Invalid display preference: fall back to `sticker`, retain the damaged value for diagnosis and do not show a second onboarding prompt.
- Invalid theme: use the built-in default theme; playback and lyric fetch continue.
- Missing accompaniment: return to single-player selection or ordinary playback.
- Microphone denial: play accompaniment without scoring.
- LAN failure: keep the local solo session and queue independent of the normal player queue.
- Delivery boundary (2026-11-17): the LAN host runtime, client snapshot protocol, media manager and desktop/mobile UI fixtures are complete and tested, but production wiring is not. `FeatureWorkbench` still opens only the local solo practice page; `KaraokeLanHost` is exercised by tests only. Real LAN sessions still need the transport binding, join approval UI, reconnect recovery and per-platform entry points before any release claims LAN karaoke. This gap must ship separately; it is not part of the UI-refresh/karaoke-solo scope.

## Score contract

Trusted pitch references produce explainable line scores. Without pitch reference data, pitch is `null` and the UI must not claim professional intonation scoring. Default weights are pitch 45%, rhythm 25%, lyrics 15%, completeness 10%, and volume/breath 5%.

## Local-only scope

This stage does not push branches, create a PR, package an installer, or change an update channel. Real multi-device acceptance remains an explicit separate verification condition.
