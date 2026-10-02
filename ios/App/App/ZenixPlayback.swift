import Foundation
import UIKit
import AVFoundation
import MediaPlayer
import ImageIO

/// All player state lives on the main queue; source work and disk ranges live elsewhere.
final class ZenixPlayback {
    let cache: ZenixAudioCache
    private let store: ZenixStore, sources: ZenixSources, player = AVPlayer()
    private let worker = DispatchQueue(label: "zenix.playback.resolve"), generationLock = NSLock()
    private var generation = 0, queue: [JSONObject], index: Int, desired = false, shuffle = false, repeatMode = "all", quality = "high", errorMessage = ""
    private var activity: JSONObject?, attempts: Set<String> = [], loader: ZenixAudioLoader?, cachedURL: URL?, recorded = false, interrupted = false
    private var itemObserver: NSKeyValueObservation?, statusObserver: NSKeyValueObservation?, timeObserver: Any?, deadline: DispatchWorkItem?
    private var observers: [NSObjectProtocol] = [], commands: [(MPRemoteCommand, Any)] = [], coverRequest: SourceRequest?, artwork: MPMediaItemArtwork?
    var onChange: (() -> Void)?
    var onTick: (() -> Void)?
    init(store: ZenixStore, sources: ZenixSources) throws {
        self.store = store; self.sources = sources; cache = try ZenixAudioCache(store)
        let saved = store.read()
        queue = saved["queue"] as? [JSONObject] ?? []; index = saved["queueIndex"] as? Int ?? -1
        if !queue.indices.contains(index) { index = queue.isEmpty ? -1 : 0 }
        shuffle = saved["shuffle"] as? Bool ?? false; repeatMode = saved["repeat"] as? String ?? "all"; quality = saved["quality"] as? String ?? "high"
        player.automaticallyWaitsToMinimizeStalling = true
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.75, preferredTimescale: 600), queue: .main) { [weak self] _ in
            guard let self else { return }; updateNowPlaying(); if UIApplication.shared.applicationState == .active { onTick?() }
        }
        statusObserver = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in DispatchQueue.main.async { self?.statusChanged() } }
        observers.append(NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] event in guard let self, event.object as AnyObject? === player.currentItem else { return }; if repeatMode == "one" { seek(0); player.play() } else { next(1, automatic: true) } })
        observers.append(NotificationCenter.default.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: nil, queue: .main) { [weak self] event in guard let self, event.object as AnyObject? === player.currentItem else { return }; retry() })
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] event in
            guard let self, let type = event.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
            if type == AVAudioSession.InterruptionType.began.rawValue { interrupted = desired; desired = false; player.pause() }
            else { let options = AVAudioSession.InterruptionOptions(rawValue: event.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0); if interrupted && options.contains(.shouldResume) { try? activate(); desired = true; player.play() }; interrupted = false }; emit()
        })
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] event in if event.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { self?.pause() } })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.emit() })
        registerRemoteCommands()
    }
    private var track: JSONObject? { queue.indices.contains(index) ? queue[index] : nil }
    private var position: Double { let seconds = player.currentTime().seconds; return seconds.isFinite ? max(0, seconds) : 0 }
    private var duration: Double { let seconds = player.currentItem?.duration.seconds ?? .nan; return seconds.isFinite ? max(0, seconds) : track?["duration"] as? Double ?? 0 }
    func snapshot() -> JSONObject {
        var value: JSONObject = ["playing": player.timeControlStatus == .playing, "position": position, "duration": duration, "volume": player.volume, "muted": player.isMuted, "shuffle": shuffle, "repeat": repeatMode, "queue": queue, "queueIndex": index]
        if let track { value["track"] = track }; value["error"] = errorMessage
        if let activity { value["sourceActivity"] = activity } else { value["sourceActivity"] = NSNull() }
        return value
    }
    func tickSnapshot() -> JSONObject { ["position": position, "duration": duration, "playing": player.timeControlStatus == .playing] }
    func play(_ tracks: [JSONObject], index requested: Int) throws {
        guard !tracks.isEmpty, tracks.count <= 10000, tracks.indices.contains(requested), tracks.allSatisfy({ $0["id"] is String && $0["title"] is String }) else { throw failure("播放队列无效") }
        try store.set("queue", tracks.map(ZenixStore.clean)); try store.set("queueIndex", requested)
        queue = tracks; index = requested; start()
    }
    private func token() -> Int { generationLock.lock(); defer { generationLock.unlock() }; generation += 1; return generation }
    private func current(_ token: Int) -> Bool { generationLock.lock(); defer { generationLock.unlock() }; return generation == token }
    private func start(resetAttempts: Bool = true) {
        guard let track else { return }; let token = token(); clearItem(); desired = true; errorMessage = ""; recorded = false; artwork = nil; coverRequest?.cancel(); coverRequest = nil
        if resetAttempts { attempts.removeAll() }
        do { try activate() } catch { fail(error.localizedDescription); return }
        updateNowPlaying(); progress("connecting", "正在连接音乐资源")
        let id = track["id"] as? String ?? "", preferred = quality == "lossless" ? ["lossless", "high", "standard"] : ["high", "standard", "lossless"]
        if track["source"] as? String == "local", let path = track["path"] as? String, FileManager.default.fileExists(atPath: path) { install(AVPlayerItem(url: URL(fileURLWithPath: path)), token: token); loadArtwork(track); return }
        if !attempts.contains("cache"), let file = cache.find(id, qualities: preferred) { attempts.insert("cache"); cachedURL = file; cache.protect(file); progress("cache", "正在读取本地缓存"); install(AVPlayerItem(url: file), token: token); loadArtwork(track); return }
        resolve(track, token: token)
    }
    private func resolve(_ track: JSONObject, token: Int) {
        var tried = attempts; let quality = quality
        worker.async { [weak self] in
            guard let self else { return }
            do {
                let result = try sources.resolve(track, attempts: &tried, quality: quality, cancelled: { !self.current(token) }, progress: { phase, message in DispatchQueue.main.async { [weak self] in guard let self, current(token) else { return }; progress(phase, message) } })
                guard current(token) else { return }; let url = try SourceNetwork.validate(result["url"] as? String ?? "")
                DispatchQueue.main.async { [weak self] in
                    guard let self, current(token) else { return }; attempts = tried
                    let headers = (result["headers"] as? JSONObject ?? [:]).mapValues { String(describing: $0) }
                    let transport = ZenixAudioLoader(remote: url, headers: headers, cache: cache, id: track["id"] as? String ?? "", quality: result["quality"] as? String ?? "standard", allowedHosts: result["allowedHosts"] as? [String])
                    loader = transport; progress("buffering", "音频已找到，正在准备播放"); install(AVPlayerItem(asset: transport.asset()), token: token); loadArtwork(track)
                }
            } catch { DispatchQueue.main.async { [weak self] in guard let self, current(token) else { return }; attempts = tried; fail(error.localizedDescription) } }
        }
    }
    private func install(_ item: AVPlayerItem, token: Int) {
        // A modest forward buffer avoids retaining minutes of lossless audio.
        item.preferredForwardBufferDuration = 15
        player.replaceCurrentItem(with: item)
        itemObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in DispatchQueue.main.async { [weak self] in
            guard let self, current(token), player.currentItem === item else { return }
            if item.status == .failed { retry() }
            else if item.status == .readyToPlay { if desired { player.play() } else { deadline?.cancel(); activity = nil }; emit() }
        } }
        deadline?.cancel(); let job = DispatchWorkItem { [weak self] in guard let self, current(token), activity != nil else { return }; retry() }; deadline = job; DispatchQueue.main.asyncAfter(deadline: .now() + 18, execute: job)
        if desired { player.play() }; emit()
    }
    private func retry() {
        guard let track else { return }
        if let cachedURL { cache.invalidate(cachedURL) }
        let wasDesired = desired, token = token(); clearItem(); desired = wasDesired
        if track["source"] as? String == "local" { fail("本地歌曲暂时无法播放"); return }
        progress("retrying", "当前音频无法播放，正在尝试后续资源"); resolve(track, token: token)
    }
    func toggle() throws {
        if desired { pause() }
        else if player.currentItem != nil { try activate(); desired = true; player.play(); emit() }
        else if track != nil { start() }
        else { throw failure("请先选择歌曲") }
    }
    func pause() { desired = false; player.pause(); emit() }
    func seek(_ seconds: Double) { guard seconds.isFinite else { return }; player.seek(to: CMTime(seconds: min(max(0, seconds), duration), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in DispatchQueue.main.async { self?.emit() } } }
    func next(_ direction: Int, automatic: Bool = false) {
        guard !queue.isEmpty else { return }
        if direction < 0 && position > 3 { seek(0); return }
        if automatic && repeatMode == "off" && index + 1 >= queue.count { pause(); return }
        if shuffle && queue.count > 1 { var next = index; while next == index { next = Int.random(in: queue.indices) }; index = next }
        else { index = (index + direction + queue.count) % queue.count }; try? store.set("queueIndex", index); start()
    }
    func mode(_ args: JSONObject) throws {
        if let value = args["shuffle"] as? Bool { try store.set("shuffle", value); shuffle = value }
        if let value = args["repeat"] as? String, ["all", "one", "off"].contains(value) { try store.set("repeat", value); repeatMode = value }
        if let value = args["quality"] as? String, ["high", "lossless"].contains(value) { try store.set("quality", value); quality = value }; emit()
    }
    func remove(_ id: String) throws {
        guard let removed = queue.firstIndex(where: { $0["id"] as? String == id }) else { return }
        queue.remove(at: removed); try store.set("queue", queue.map(ZenixStore.clean))
        if queue.isEmpty { _ = token(); clearItem(); index = -1; desired = false; activity = nil }
        else if removed == index { index = min(index, queue.count - 1); start() }
        else if removed < index { index -= 1 }; try store.set("queueIndex", index); emit()
    }
    func clearCache() throws {
        guard !desired else { throw failure("请先暂停，再清理缓存") }; _ = token(); clearItem(); activity = nil; try cache.clear(); emit()
    }
    private func activate() throws { let audio = AVAudioSession.sharedInstance(); try audio.setCategory(.playback, mode: .default); try audio.setActive(true); UIApplication.shared.beginReceivingRemoteControlEvents() }
    private func statusChanged() {
        if player.timeControlStatus == .playing { activity = nil; deadline?.cancel(); if !recorded, let track { recorded = true; _ = try? store.personal("record", ["track": track]) } }
        else if player.timeControlStatus == .waitingToPlayAtSpecifiedRate && desired && activity == nil { progress("buffering", "正在缓冲音频") }; emit()
    }
    private func progress(_ phase: String, _ message: String) { activity = ["phase": phase, "message": message, "startedAt": activity?["startedAt"] ?? nowMillis()]; emit() }
    private func fail(_ message: String) { desired = false; player.pause(); errorMessage = message; activity = ["phase": "failed", "message": message, "startedAt": nowMillis()]; deadline?.cancel(); emit() }
    private func clearItem() { deadline?.cancel(); deadline = nil; itemObserver = nil; player.pause(); player.replaceCurrentItem(with: nil); loader?.close(); loader = nil; if let cachedURL { cache.unprotect(cachedURL) }; cachedURL = nil }
    private func emit() { updateNowPlaying(); onChange?() }
    private func registerRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        func bind(_ command: MPRemoteCommand, _ action: @escaping (MPRemoteCommandEvent) -> Void) { command.isEnabled = true; let token = command.addTarget { event in DispatchQueue.main.async { action(event) }; return .success }; commands.append((command, token)) }
        bind(center.playCommand) { [weak self] _ in guard let self else { return }; if !desired { try? toggle() } }
        bind(center.pauseCommand) { [weak self] _ in self?.pause() }
        bind(center.togglePlayPauseCommand) { [weak self] _ in try? self?.toggle() }
        bind(center.nextTrackCommand) { [weak self] _ in self?.next(1) }
        bind(center.previousTrackCommand) { [weak self] _ in self?.next(-1) }
        bind(center.changePlaybackPositionCommand) { [weak self] event in if let event = event as? MPChangePlaybackPositionCommandEvent { self?.seek(event.positionTime) } }
    }
    private func updateNowPlaying() {
        guard let track else { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil; return }
        var info: JSONObject = [MPMediaItemPropertyTitle: track["title"] ?? "", MPMediaItemPropertyArtist: track["artist"] ?? "", MPNowPlayingInfoPropertyElapsedPlaybackTime: position, MPMediaItemPropertyPlaybackDuration: duration, MPNowPlayingInfoPropertyPlaybackRate: player.timeControlStatus == .playing ? 1.0 : 0.0, MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0, MPNowPlayingInfoPropertyPlaybackQueueIndex: index, MPNowPlayingInfoPropertyPlaybackQueueCount: queue.count]
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }; MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
    private func loadArtwork(_ track: JSONObject) {
        guard let url = track["coverUrl"] as? String else { return }; let id = track["id"] as? String
        if url.hasPrefix("/") { if let data = try? Data(contentsOf: URL(fileURLWithPath: url)) { applyArtwork(data, id: id) }; return }
        DispatchQueue.global(qos: .utility).async { [weak self] in guard let self else { return }; let job = SourceNetwork.request(url) { [weak self] result in
            if case .success(let value) = result, let data = Data(base64Encoded: value["data"] as? String ?? "") { DispatchQueue.main.async { self?.applyArtwork(data, id: id) } }
        }; DispatchQueue.main.async { [weak self] in self?.coverRequest = job } }
    }
    private func applyArtwork(_ data: Data, id: String?) {
        guard track?["id"] as? String == id, let source = CGImageSourceCreateWithData(data as CFData, nil), let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 256, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) else { return }
        let image = UIImage(cgImage: cg); artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }; updateNowPlaying()
    }
    deinit { deadline?.cancel(); loader?.close(); coverRequest?.cancel(); if let timeObserver { player.removeTimeObserver(timeObserver) }; observers.forEach(NotificationCenter.default.removeObserver); for (command, token) in commands { command.removeTarget(token) } }
}
