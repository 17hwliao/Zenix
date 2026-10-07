/* Zenix's local recommendation rules. Keep this module free of platform APIs. */
var zenixRoaming = (function () {
  'use strict';
  var DAY = 86400000;
  var own = Object.prototype.hasOwnProperty;
  function list(value) { return Array.isArray(value) ? value : []; }
  function number(value) { var n = Number(value); return isFinite(n) ? n : 0; }
  function normal(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '').replace(/["'`“”‘’.,，。!！?？:：;；·•_\-—()（）\[\]【】{}<>《》]/g, '');
  }
  function artists(track) {
    var values = String(track && track.artist || '').split(/\s*(?:[\/、&＋+]|\b(?:feat\.?|ft\.?|featuring)\b|\s[xX]\s)\s*/i);
    var found = {}, result = [];
    values.forEach(function (value) {
      var name = value.replace(/^\s+|\s+$/g, '');
      var key = normal(name);
      if (key && !own.call(found, key) && !/^(未知歌手|unknown|unknownartist|variousartists|群星)$/.test(key)) {
        found[key] = true; result.push({ key: key, name: name });
      }
    });
    return result;
  }
  function fingerprint(value) {
    var a = 2166136261, b = 5381, i;
    for (i = 0; i < value.length; i += 1) {
      var c = value.charCodeAt(i);
      a ^= c;
      a = (a + (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24)) >>> 0;
      b = (((b << 5) + b) ^ c) >>> 0;
    }
    function hex(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }
    return hex(a) + hex(b);
  }
  function identity(track) {
    if (!track) return '';
    var title = normal(track.title), names = artists(track).map(function (item) { return item.key; }).sort();
    // Bracket punctuation is removed, its contents retained: live/remix covers stay distinct.
    var key = title && names.length ? title + '|' + names.join('&') : title + '|' + normal(track.artist) + '|' + String(track.remoteId || track.path || track.id || '');
    return 'v1:' + fingerprint(key);
  }
  function createState() {
    return { version: 1, seen: {}, feedback: {}, artistAffinity: {}, recentArtists: [], queryUsage: {}, queryRound: 0, seedTracks: [] };
  }
  function prepare(state) {
    state = state && typeof state === 'object' ? state : createState();
    ['seen', 'feedback', 'artistAffinity', 'queryUsage'].forEach(function (key) {
      if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) state[key] = {};
    });
    state.recentArtists = list(state.recentArtists); state.seedTracks = list(state.seedTracks);
    state.queryRound = number(state.queryRound); state.version = 1;
    return state;
  }
  function decay(score, at, now) { return number(score) * Math.pow(0.5, Math.max(0, now - number(at || now)) / (30 * DAY)); }
  function seedItems(state, personal, now) {
    var result = [], keys = {}, p = personal || {};
    function add(track, score) {
      if (!track || !track.title || !artists(track).length) return;
      var key = identity(track);
      if (own.call(keys, key)) { result[keys[key]].score += score; return; }
      keys[key] = result.length; result.push({ track: track, score: score });
    }
    list(p.history).slice().sort(function (a, b) { return number(b.playedAt) - number(a.playedAt); }).forEach(function (entry, index) {
      add(entry.track, (index < 5 ? 7 - index * 0.6 : 1.2) * Math.pow(0.5, Math.max(0, now - number(entry.playedAt || now)) / (45 * DAY)));
    });
    list(p.liked).forEach(function (track) { add(track, 5); });
    list(p.favorites).forEach(function (track) { add(track, 4); });
    list(p.playlists).forEach(function (entry) { list(entry.tracks).forEach(function (track) { add(track, 2); }); });
    state.seedTracks.forEach(function (entry) { add(entry.track, Math.max(0.2, decay(entry.score, entry.at, now))); });
    result.sort(function (a, b) { return b.score - a.score; });
    return result.slice(0, 120);
  }
  function queries(state, personal, now) {
    state = prepare(state); now = number(now) || Date.now();
    var pool = [], keys = {};
    function add(key, keyword, score) {
      if (!keyword || keyword.length > 150) return;
      if (own.call(keys, key)) { pool[keys[key]].score += score; return; }
      keys[key] = pool.length; pool.push({ key: key, keyword: keyword, score: score });
    }
    seedItems(state, personal, now).forEach(function (item) {
      var names = artists(item.track);
      names.forEach(function (artist) {
        var affinity = state.artistAffinity[artist.key];
        add('artist:' + artist.key, artist.name, Math.max(0.1, item.score + (affinity ? decay(affinity.score, affinity.updatedAt, now) : 0)));
      });
      var album = String(item.track.album || '').replace(/^\s+|\s+$/g, '');
      if (album && !/^(未知专辑|unknown|single|单曲)$/i.test(album)) add('album:' + names[0].key + ':' + normal(album), names[0].name + ' ' + album, item.score * 0.6);
    });
    pool.forEach(function (query) {
      var usage = state.queryUsage[query.key] || {};
      // Less-used seeds get a turn before endlessly paging one favourite artist.
      query.priority = query.score / (1 + number(usage.count) * 0.7) - (now - number(usage.lastAt) < 15000 ? 3 : 0);
    });
    pool.sort(function (a, b) { return b.priority - a.priority || (a.key < b.key ? -1 : 1); });
    var selected = pool.slice(0, 12).map(function (query) {
      var usage = state.queryUsage[query.key] || { count: 0, lastAt: 0 };
      state.queryUsage[query.key] = { count: number(usage.count) + 1, lastAt: now };
      return { key: query.key, keyword: query.keyword };
    });
    if (selected.length) state.queryRound += 1;
    return selected;
  }
  function rank(state, personal, candidates, now) {
    state = prepare(state); now = number(now) || Date.now();
    var excluded = {}, knownArtists = {}, affinity = {}, unique = {}, ranked = [];
    list(personal && personal.history).forEach(function (entry) { if (entry.track) excluded[identity(entry.track)] = true; });
    seedItems(state, personal, now).forEach(function (seed) {
      artists(seed.track).forEach(function (artist) {
        knownArtists[artist.key] = true; affinity[artist.key] = number(affinity[artist.key]) + seed.score;
      });
    });
    list(candidates).forEach(function (track) {
      if (!track || !track.title || !artists(track).length) return;
      var key = identity(track);
      if (own.call(state.seen, key) || own.call(excluded, key)) return;
      if (own.call(unique, key)) {
        var previous = unique[key].track;
        if (!previous.coverUrl && track.coverUrl) unique[key].track = track;
        return;
      }
      var names = artists(track), match = 0, learned = 0, familiar = false;
      names.forEach(function (artist) {
        match = Math.max(match, number(affinity[artist.key]));
        familiar = familiar || own.call(knownArtists, artist.key);
        var value = state.artistAffinity[artist.key];
        learned += value ? decay(value.score, value.updatedAt, now) : 0;
      });
      var record = state.feedback[key];
      var score = Math.log(1 + Math.max(0, match)) * 3 + Math.max(-8, Math.min(8, learned)) + (record ? decay(record.score, record.updatedAt, now) : 0);
      score += familiar ? 1 : 3; // Unknown neighbours are useful discoveries, not excluded.
      score += (parseInt(key.slice(-8), 16) % 997) / 997 * 1.5;
      var item = { track: track, names: names, score: score };
      unique[key] = item; ranked.push(item);
    });
    var output = [], recent = state.recentArtists.slice(-5);
    while (ranked.length) {
      var best = 0, bestScore = -Infinity;
      ranked.forEach(function (item, index) {
        var penalty = 0;
        item.names.forEach(function (artist) {
          if (recent.length && artist.key === recent[recent.length - 1]) penalty += 9;
          else if (recent.indexOf(artist.key) !== -1) penalty += 2;
        });
        var score = item.score - penalty;
        if (score > bestScore) { bestScore = score; best = index; }
      });
      var selected = ranked.splice(best, 1)[0]; output.push(selected.track);
      recent.push(selected.names[0].key); recent = recent.slice(-5);
    }
    return output;
  }
  function addScore(state, track, score, now) {
    artists(track).forEach(function (artist) {
      var previous = state.artistAffinity[artist.key];
      state.artistAffinity[artist.key] = { score: Math.max(-15, Math.min(30, (previous ? decay(previous.score, previous.updatedAt, now) : 0) + score)), updatedAt: now };
    });
  }
  function consume(state, track, reason, seconds, duration, now) {
    state = prepare(state); if (!track || !track.title) return state;
    now = number(now) || Date.now(); seconds = Math.max(0, number(seconds)); duration = Math.max(0, number(duration || track.duration));
    if (duration > 0) seconds = Math.min(seconds, duration);
    var key = identity(track), previousSeen = state.seen[key];
    state.seen[key] = { reason: reason || 'played', at: previousSeen ? previousSeen.at : now };
    // A selection cancelled before audible playback is a resource interruption,
    // not a dislike. Keep its delivery fingerprint without changing preferences.
    if (reason === 'failed' || reason === 'played' && seconds <= 0.1 || reason === 'skip' && seconds <= 0.1) return state;
    var record = state.feedback[key] || { score: 0, listened: 0, plays: 0, skips: 0, updatedAt: now };
    var ratio = duration > 0 ? seconds / duration : 0;
    var signal = reason === 'dislike' ? -4 : (seconds >= 30 || ratio >= 0.5 ? (ratio >= 0.8 ? 3 : ratio >= 0.5 ? 2 : 0.5) : 0);
    if (reason === 'skip') { record.skips += 1; if (seconds < 15 && ratio < 0.5) signal -= 0.7; }
    record.score = Math.max(-20, Math.min(30, decay(record.score, record.updatedAt, now) + signal));
    record.listened += seconds; if (seconds >= 30 || ratio >= 0.5) record.plays += 1;
    record.updatedAt = now; state.feedback[key] = record; addScore(state, track, signal, now);
    var names = artists(track);
    if (names.length) { state.recentArtists.push(names[0].key); state.recentArtists = state.recentArtists.slice(-5); }
    if (signal > 0) {
      state.seedTracks = state.seedTracks.filter(function (entry) { return identity(entry.track) !== key; });
      state.seedTracks.unshift({ track: { id: String(track.id || key), title: String(track.title), artist: String(track.artist || ''), album: String(track.album || ''), duration: duration }, score: signal, at: now });
      state.seedTracks = state.seedTracks.slice(0, 64);
    }
    return prune(state);
  }
  function feedback(state, track, kind, now) {
    state = prepare(state); if (!track || !track.title) return state;
    now = number(now) || Date.now();
    var score = kind === 'liked' ? 4 : kind === 'favorites' ? 3 : kind === 'playlist' ? 2 : kind === 'dislike' ? -4 : 0;
    var key = identity(track), record = state.feedback[key] || { score: 0, listened: 0, plays: 0, skips: 0, updatedAt: now };
    record.score = Math.max(-20, Math.min(30, decay(record.score, record.updatedAt, now) + score)); record.updatedAt = now;
    state.feedback[key] = record; addScore(state, track, score, now);
    if (kind === 'dislike') state.seen[key] = { reason: 'dislike', at: now };
    return prune(state);
  }
  function prune(state) {
    state = prepare(state);
    function trim(field, maximum, dateField) {
      var map = state[field], keys = Object.keys(map);
      if (keys.length <= maximum) return;
      keys.sort(function (a, b) { return number(map[b][dateField]) - number(map[a][dateField]); });
      keys.slice(maximum).forEach(function (key) { delete map[key]; });
    }
    trim('feedback', 1000, 'updatedAt'); trim('artistAffinity', 256, 'updatedAt'); trim('queryUsage', 256, 'lastAt');
    state.seedTracks = state.seedTracks.slice(0, 64); state.recentArtists = state.recentArtists.slice(-5);
    // Never prune seen: persistence owns the lifetime non-repetition guarantee.
    return state;
  }
  return { identity: identity, createState: createState, queries: queries, rank: rank, consume: consume, feedback: feedback, prune: prune };
}());

if (typeof module !== 'undefined' && module.exports) module.exports = zenixRoaming;
else globalThis.zenixRoaming = zenixRoaming;
