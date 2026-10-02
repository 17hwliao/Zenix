import Foundation
import AVFoundation
import UniformTypeIdentifiers

/// Only complete files enter the persistent inventory; interrupted ranges never masquerade as offline songs.
final class ZenixAudioCache {
    let directory: URL
    private let store: ZenixStore, lock = NSRecursiveLock()
    private var entries: [JSONObject] = [], protected: Set<String> = []
    private var epoch = 0
    var generation: Int { lock.lock(); defer { lock.unlock() }; return epoch }
    init(_ store: ZenixStore) throws {
        self.store = store
        directory = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("ZenixAudio", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let bytes = try? Data(contentsOf: directory.appendingPathComponent("index.json")), let rows = try? JSONSerialization.jsonObject(with: bytes) as? [JSONObject] { entries = rows.filter { FileManager.default.fileExists(atPath: directory.appendingPathComponent($0["file"] as? String ?? "missing").path) } }
        for file in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] where file.pathExtension == "partial" { try? FileManager.default.removeItem(at: file) }
        prune()
    }
    var enabled: Bool { store.value("cacheEnabled") as? Bool ?? true }
    var limit: Int { store.value("cacheLimitMiB") as? Int ?? 512 }
    func stats() -> JSONObject { lock.lock(); defer { lock.unlock() }; return ["enabled": enabled, "limitMiB": limit, "usedBytes": entries.reduce(Int64(0)) { $0 + ($1["size"] as? Int64 ?? 0) }] }
    func find(_ id: String, qualities: [String]) -> URL? {
        lock.lock(); defer { lock.unlock() }
        for quality in qualities {
            guard let index = entries.firstIndex(where: { $0["id"] as? String == id && $0["quality"] as? String == quality }) else { continue }
            let url = directory.appendingPathComponent(entries[index]["file"] as? String ?? "missing")
            if FileManager.default.fileExists(atPath: url.path) { entries[index]["touched"] = nowMillis(); save(); return url }
        }
        return nil
    }
    func protect(_ url: URL) { lock.lock(); protected.insert(url.lastPathComponent); lock.unlock() }
    func unprotect(_ url: URL) { lock.lock(); protected.remove(url.lastPathComponent); lock.unlock() }
    func invalidate(_ url: URL) { lock.lock(); defer { lock.unlock() }; protected.remove(url.lastPathComponent); entries.removeAll { $0["file"] as? String == url.lastPathComponent }; try? FileManager.default.removeItem(at: url); save() }
    func commit(_ partial: URL, id: String, quality: String, size: Int64, ext: String, generation: Int) throws {
        lock.lock(); defer { lock.unlock() }
        guard enabled, epoch == generation, size <= Int64(limit) * 1024 * 1024 else { return }
        let file = sha(id + ":" + quality) + "." + ext, destination = directory.appendingPathComponent(file)
        if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
        try FileManager.default.copyItem(at: partial, to: destination)
        entries.removeAll { $0["id"] as? String == id && $0["quality"] as? String == quality }
        entries.append(["id": id, "quality": quality, "file": file, "size": size, "touched": nowMillis()]); prune(); save()
    }
    func configure(_ args: JSONObject) throws {
        if let enabled = args["enabled"] as? Bool { try store.set("cacheEnabled", enabled); if !enabled { lock.lock(); epoch += 1; lock.unlock() } }
        if let value = args["limitMiB"] as? Int { guard [128, 256, 512, 1024, 2048].contains(value) else { throw failure("缓存上限无效") }; try store.set("cacheLimitMiB", value) }; prune()
    }
    func clear() throws {
        lock.lock(); defer { lock.unlock() }
        epoch += 1
        for entry in entries { let file = entry["file"] as? String ?? ""; if !protected.contains(file) { try? FileManager.default.removeItem(at: directory.appendingPathComponent(file)) } }
        entries.removeAll { !protected.contains($0["file"] as? String ?? "") }; save()
    }
    private func prune() {
        lock.lock(); defer { lock.unlock() }
        entries.sort { ($0["touched"] as? Double ?? 0) < ($1["touched"] as? Double ?? 0) }
        var size = entries.reduce(Int64(0)) { $0 + ($1["size"] as? Int64 ?? 0) }
        var remove: Set<String> = []
        for entry in entries where size > Int64(limit) * 1024 * 1024 {
            let file = entry["file"] as? String ?? ""; if protected.contains(file) { continue }
            size -= entry["size"] as? Int64 ?? 0; remove.insert(file); try? FileManager.default.removeItem(at: directory.appendingPathComponent(file))
        }
        entries.removeAll { remove.contains($0["file"] as? String ?? "") }; save()
    }
    private func save() { if let bytes = try? JSONSerialization.data(withJSONObject: entries) { try? bytes.write(to: directory.appendingPathComponent("index.json"), options: .atomic) } }
}

/// AVPlayer ranges stream through URLSession into a sparse file and directly into the player.
/// There is no second download and no full-song Data buffer. Seeked ranges merge before cache commit.
final class ZenixAudioLoader: NSObject, AVAssetResourceLoaderDelegate, URLSessionDataDelegate {
    let queue = DispatchQueue(label: "zenix.audio.ranges")
    private let remote: URL, headers: [String: String], cache: ZenixAudioCache, id: String, quality: String
    private let cacheGeneration: Int
    private let allowedHosts: [String]?
    private var session: URLSession!, jobs: [Int: RangeJob] = [:], partial: URL, file: FileHandle?, ranges: [(Int64, Int64)] = [], length: Int64 = 0, committed = false, contentType = UTType.audio.identifier, ext = "bin", closed = false
    private final class RangeJob {
        let request: AVAssetResourceLoadingRequest, task: URLSessionDataTask, start: Int64, end: Int64?
        var cursor: Int64 = 0, redirects = 0
        init(_ request: AVAssetResourceLoadingRequest, _ task: URLSessionDataTask, start: Int64, end: Int64?) { self.request = request; self.task = task; self.start = start; self.end = end }
    }
    init(remote: URL, headers: [String: String], cache: ZenixAudioCache, id: String, quality: String, allowedHosts: [String]?) {
        self.remote = remote; self.headers = headers; self.cache = cache; self.id = id; self.quality = quality; cacheGeneration = cache.generation
        self.allowedHosts = allowedHosts
        partial = cache.directory.appendingPathComponent(UUID().uuidString + ".partial")
        super.init()
        if cache.enabled { FileManager.default.createFile(atPath: partial.path, contents: nil); file = try? FileHandle(forUpdating: partial) }
        let config = URLSessionConfiguration.ephemeral; config.urlCache = nil; config.httpCookieStorage = nil; config.timeoutIntervalForRequest = 15; config.timeoutIntervalForResource = 300
        let operation = OperationQueue(); operation.maxConcurrentOperationCount = 1; operation.underlyingQueue = queue
        session = URLSession(configuration: config, delegate: self, delegateQueue: operation)
    }
    func asset() -> AVURLAsset {
        var components = URLComponents(url: remote, resolvingAgainstBaseURL: false)!; components.scheme = "zenix-audio"
        let asset = AVURLAsset(url: components.url!); asset.resourceLoader.setDelegate(self, queue: queue); return asset
    }
    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, shouldWaitForLoadingOfRequestedResource request: AVAssetResourceLoadingRequest) -> Bool {
        guard !closed else { request.finishLoading(with: failure("播放已结束")); return false }
        let data = request.dataRequest, start = data.map { max($0.requestedOffset, $0.currentOffset) } ?? 0
        let end: Int64?
        if let data { end = data.requestsAllDataToEndOfResource ? nil : data.requestedOffset + Int64(data.requestedLength) - 1 } else { end = 1 }
        var network = URLRequest(url: remote); for (key, value) in headers where !["host", "range", "content-length", "connection"].contains(key.lowercased()) { network.setValue(value, forHTTPHeaderField: key) }
        network.setValue("identity", forHTTPHeaderField: "Accept-Encoding"); network.setValue("bytes=\(start)-\(end.map(String.init) ?? "")", forHTTPHeaderField: "Range")
        let task = session.dataTask(with: network); jobs[task.taskIdentifier] = RangeJob(request, task, start: start, end: end); task.resume(); return true
    }
    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel request: AVAssetResourceLoadingRequest) { for (key, job) in jobs where job.request === request { job.task.cancel(); jobs.removeValue(forKey: key) } }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let job = jobs[task.taskIdentifier] else { completionHandler(nil); return }; job.redirects += 1
        guard job.redirects <= 5, let text = request.url?.absoluteString, (try? SourceNetwork.validate(text, hosts: allowedHosts)) != nil else { completionHandler(nil); return }
        var next = request
        if task.currentRequest?.url?.host != request.url?.host { next.setValue(nil, forHTTPHeaderField: "Authorization"); next.setValue(nil, forHTTPHeaderField: "Cookie") }
        completionHandler(next)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let job = jobs[dataTask.taskIdentifier], let response = response as? HTTPURLResponse, [200, 206].contains(response.statusCode) else { completionHandler(.cancel); return }
        let mime = response.mimeType ?? "audio/mpeg"
        guard !mime.contains("html"), !mime.contains("json"), !mime.contains("mpegurl") else { job.request.finishLoading(with: failure("资源不是可播放的音频文件")); jobs.removeValue(forKey: dataTask.taskIdentifier); completionHandler(.cancel); return }
        let range = response.value(forHTTPHeaderField: "Content-Range") ?? ""
        let total = range.isEmpty ? response.expectedContentLength : (range.split(separator: "/").last.flatMap { Int64($0) } ?? 0)
        job.cursor = response.statusCode == 206 ? Int64(range.components(separatedBy: " ").last?.split(separator: "-").first ?? "0") ?? job.start : 0
        if total > 0 {
            if length > 0 && length != total { job.request.finishLoading(with: failure("音频内容发生变化，请重新播放")); completionHandler(.cancel); return }; length = total
        }
        if let type = UTType(mimeType: mime) ?? UTType(filenameExtension: remote.pathExtension), type.conforms(to: .audio) { contentType = type.identifier; ext = type.preferredFilenameExtension ?? "bin" }
        if let info = job.request.contentInformationRequest { info.contentType = contentType; info.contentLength = length; info.isByteRangeAccessSupported = response.statusCode == 206 || response.value(forHTTPHeaderField: "Accept-Ranges") == "bytes" }
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let job = jobs[dataTask.taskIdentifier] else { return }
        let start = job.cursor, stop = start + Int64(data.count); job.cursor = stop
        if let file, cache.enabled, cache.generation == cacheGeneration, stop <= min(Int64(cache.limit) * 1024 * 1024, 256 * 1024 * 1024) {
            do { try file.seek(toOffset: UInt64(start)); try file.write(contentsOf: data); merge(start, stop); commitIfComplete() } catch { disableCache() }
        } else if file != nil { disableCache() }
        if let request = job.request.dataRequest {
            let requestedStart = max(request.requestedOffset, request.currentOffset), requestedEnd = job.end.map { $0 + 1 } ?? stop
            let from = max(start, requestedStart), to = min(stop, requestedEnd)
            if to > from { request.respond(with: data.subdata(in: Int(from - start)..<Int(to - start))) }
            if let end = job.end, request.currentOffset > end { job.request.finishLoading(); jobs.removeValue(forKey: dataTask.taskIdentifier); dataTask.cancel() }
        } else { job.request.finishLoading(); jobs.removeValue(forKey: dataTask.taskIdentifier); dataTask.cancel() }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let job = jobs.removeValue(forKey: task.taskIdentifier) else { return }
        if let error { job.request.finishLoading(with: error) }
        else if let end = job.end, job.cursor <= end, (length == 0 || job.cursor < length) { job.request.finishLoading(with: failure("音频数据不完整")) }
        else { job.request.finishLoading(); commitIfComplete() }
    }
    private func merge(_ start: Int64, _ end: Int64) {
        ranges.append((start, end)); ranges.sort { $0.0 < $1.0 }; var next: [(Int64, Int64)] = []
        for range in ranges { if let last = next.last, last.1 >= range.0 { next[next.count - 1].1 = max(last.1, range.1) } else { next.append(range) } }; ranges = next
    }
    private func commitIfComplete() {
        guard !committed, length > 0, ranges.count == 1, ranges[0].0 == 0, ranges[0].1 >= length, let file else { return }
        do { try file.synchronize(); try cache.commit(partial, id: id, quality: quality, size: length, ext: ext, generation: cacheGeneration); committed = true } catch { disableCache() }
    }
    private func disableCache() { try? file?.close(); file = nil; ranges.removeAll(); try? FileManager.default.removeItem(at: partial) }
    func close() { queue.async { [self] in guard !closed else { return }; closed = true; for job in jobs.values { job.task.cancel(); job.request.finishLoading(with: failure("播放已结束")) }; jobs.removeAll(); session.invalidateAndCancel(); disableCache() } }
}
