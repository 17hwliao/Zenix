function normalized(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, '').trim().replace(/\s+/g, ' '); }
function sameRecording(a, b) {
  // Keep version qualifiers in the full title. Missing timing/artist is ambiguous.
  return a.source === 'custom' && b.source === 'custom' && a.providerId !== b.providerId
    && normalized(a.title) !== '' && normalized(a.artist) !== ''
    && normalized(a.title) === normalized(b.title) && normalized(a.artist) === normalized(b.artist)
    && (!a.album || !b.album || normalized(a.album) === normalized(b.album))
    && Number.isFinite(a.duration) && Number.isFinite(b.duration) && a.duration > 0 && b.duration > 0
    && Math.abs(a.duration - b.duration) <= 3;
}
function plain(track) { const { searchAlternatives, ...result } = track; return result; }
function variants(track) { return track.searchAlternatives?.length ? track.searchAlternatives : [track]; }
function containsTrack(group, id) { return group.id === id || variants(group).some(track => track.id === id); }
function recordingKey(track) { return track.source === 'custom' && track.duration > 0 && normalized(track.title) && normalized(track.artist) ? `${normalized(track.title)}\0${normalized(track.artist)}` : ''; }
function mergeSearchGroups(previous, incoming) {
  const groups = previous.slice(), byId = new Map(), recordings = new Map();
  const indexGroup = (group, index) => { const key = recordingKey(group); if (key) { const indexes = recordings.get(key) || []; indexes.push(index); recordings.set(key, indexes); } };
  groups.forEach((group, index) => { variants(group).forEach(track => byId.set(track.id, index)); indexGroup(group, index); });
  for (const raw of incoming) for (const candidate of variants(raw)) {
    const track = plain(candidate); if (byId.has(track.id)) continue;
    // All alternatives must agree, avoiding transitive merges through uncertain metadata.
    const index = (recordings.get(recordingKey(track)) || []).find(index => variants(groups[index]).every(other => sameRecording(other, track))) ?? -1;
    if (index < 0) { byId.set(track.id, groups.length); indexGroup(track, groups.length); groups.push(track); }
    else { const group = groups[index]; groups[index] = { ...group, searchAlternatives: [...variants(group).map(plain), track] }; byId.set(track.id, index); }
  }
  return groups;
}
function queueForSelection(groups, selected) {
  const at = groups.findIndex(group => containsTrack(group, selected.id));
  if (at < 0) return [plain(selected), ...groups.map(plain)];
  return groups.map((group, index) => plain(index === at ? selected : group));
}
const api = { normalized, sameRecording, variants, containsTrack, mergeSearchGroups, queueForSelection };

if (typeof module !== "undefined" && module.exports) module.exports = api;
else globalThis.zenixSearchGroups = api;
