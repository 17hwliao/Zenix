# Zenbot assets

Imported from the user's local codex-pet worktree on 2026-11-27, based on commit 32031a07a7e7aaa850f6248a17d41ea6b3140a7d and its accepted uncommitted character assets.

The Zenbot sprite manifest declares `user-owned-local`. Only Zenbot PNG assets and declarative manifests are reused. Source master art is retained in the original project.

`renderer.js` is Zenix's independent Canvas 2D integration. It reads the part boxes, pivots and textures from the manifest and supplies its own motion transforms. Its motion rendering differs from the original project's mesh renderer.

The original `src/renderer/kit/body.js` and `rig.js` carry Coopanion's AGPL-3.0-or-later notice. Those runtime files, the whale character and the original application backend are outside this asset import.
