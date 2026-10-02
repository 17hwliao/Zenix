import Foundation
import CryptoKit

typealias JSONObject = [String: Any]
func failure(_ message: String) -> NSError { NSError(domain: "Zenix", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
func jsonString(_ object: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.fragmentsAllowed, .sortedKeys])
    return String(decoding: data, as: UTF8.self)
}
func jsonObject(_ text: String) throws -> Any { try JSONSerialization.jsonObject(with: Data(text.utf8), options: .fragmentsAllowed) }
func sha(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }
func nowMillis() -> Double { Date().timeIntervalSince1970 * 1000 }

/// One atomic inventory, independent of the web view. Temporary stream URLs never persist.
final class ZenixStore {
    let directory: URL
    private let file: URL
    private var data: JSONObject
    private let lock = NSRecursiveLock()
    init() throws {
        directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("Zenix", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        file = directory.appendingPathComponent("inventory.json")
        if let bytes = try? Data(contentsOf: file), let saved = try? JSONSerialization.jsonObject(with: bytes) as? JSONObject { data = saved }
        else { data = ["personal": ["liked": [], "favorites": [], "history": [], "playlists": []], "sources": [], "queue": [], "localTracks": [], "profile": ["name": "Zenix", "bio": "你的音乐，自成宇宙。"], "cacheLimitMiB": 512, "cacheEnabled": true, "appearance": ["completed": false, "background": NSNull()]] }
        var location = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try location.setResourceValues(values)
    }
    func read() -> JSONObject { lock.lock(); defer { lock.unlock() }; return translate(data, storing: false) as? JSONObject ?? [:] }
    /// Read a single detached subtree instead of walking songs and playlists for scalar options.
    func value(_ key: String) -> Any? { lock.lock(); defer { lock.unlock() }; guard let value = data[key] else { return nil }; return translate(value, storing: false, key: key) }
    func set(_ key: String, _ value: Any) throws {
        lock.lock(); defer { lock.unlock() }
        var next = data; next[key] = translate(value, storing: true, key: key)
        let bytes = try JSONSerialization.data(withJSONObject: next, options: [.sortedKeys])
        try bytes.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        data = next
    }
    // iOS may relocate an application's sandbox after an update. Persist relative file references.
    private func translate(_ value: Any, storing: Bool, key: String = "") -> Any {
        if let object = value as? JSONObject { return object.mapValuesWithKeys { translate($0.value, storing: storing, key: $0.key) } }
        if let array = value as? [Any] { return array.map { translate($0, storing: storing, key: key) } }
        guard let text = value as? String, ["path", "audioUrl", "coverUrl", "url"].contains(key) else { return value }
        let marker = "zenix-private://"
        if storing && text.hasPrefix(directory.path + "/") { return marker + text.dropFirst(directory.path.count + 1) }
        if !storing && text.hasPrefix(marker) {
            let relative = String(text.dropFirst(marker.count)); guard !relative.split(separator: "/").contains("..") else { return "" }
            return directory.appendingPathComponent(relative).path
        }
        if !storing, text.hasPrefix("/"), let range = text.range(of: "/Library/Application Support/Zenix/") { return directory.appendingPathComponent(String(text[range.upperBound...])).path }
        return value
    }
    static func clean(_ track: JSONObject) -> JSONObject {
        var value = track
        if value["source"] as? String != "local" { value["audioUrl"] = ""; value.removeValue(forKey: "headers"); value.removeValue(forKey: "resolvedUrl") }
        return value
    }
    func personal(_ operation: String, _ args: JSONObject) throws -> JSONObject {
        lock.lock(); defer { lock.unlock() }
        var personal = data["personal"] as? JSONObject ?? [:]
        let id = args["id"] as? String ?? "", track = args["track"] as? JSONObject
        switch operation {
        case "toggle":
            guard let kind = args["kind"] as? String, ["liked", "favorites"].contains(kind), let track, let trackID = track["id"] as? String else { throw failure("无效收藏操作") }
            let rows = personal[kind] as? [JSONObject] ?? []; var next = rows.filter { $0["id"] as? String != trackID }
            if rows.count == next.count { next.append(Self.clean(track)) }; personal[kind] = next
        case "record":
            guard let track, let trackID = track["id"] as? String else { throw failure("缺少歌曲") }
            let rows = personal["history"] as? [JSONObject] ?? []
            personal["history"] = Array(([["id": trackID, "track": Self.clean(track), "playedAt": nowMillis()]] + rows.filter { $0["id"] as? String != trackID }).prefix(300))
        case "createPlaylist":
            let name = try playlistName(args); var rows = personal["playlists"] as? [JSONObject] ?? []
            rows.append(["id": "list-" + UUID().uuidString, "name": name, "tracks": track.map { [Self.clean($0)] } ?? []]); personal["playlists"] = rows
        case "removeSaved":
            guard let kind = args["kind"] as? String, ["liked", "favorites", "history"].contains(kind) else { throw failure("无效列表") }
            personal[kind] = (personal[kind] as? [JSONObject] ?? []).filter { $0["id"] as? String != id }
        default:
            var rows = personal["playlists"] as? [JSONObject] ?? []
            guard let index = rows.firstIndex(where: { $0["id"] as? String == id }) else { throw failure("歌单不存在") }
            switch operation {
            case "deletePlaylist": rows.remove(at: index)
            case "renamePlaylist": rows[index]["name"] = try playlistName(args)
            case "addToPlaylist", "removeFromPlaylist":
                let trackID = track?["id"] as? String ?? args["trackId"] as? String ?? ""
                guard !trackID.isEmpty else { throw failure("缺少歌曲") }
                var songs = (rows[index]["tracks"] as? [JSONObject] ?? []).filter { $0["id"] as? String != trackID }
                if operation == "addToPlaylist", let track { songs.append(Self.clean(track)) }; rows[index]["tracks"] = songs
            default: throw failure("未知歌单操作")
            }
            personal["playlists"] = rows
        }
        try set("personal", personal); return translate(personal, storing: false) as? JSONObject ?? personal
    }
    private func playlistName(_ args: JSONObject) throws -> String {
        let name = (args["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 80 else { throw failure("请填写 1–80 字的歌单名称") }; return name
    }
    func artwork(_ id: String, _ url: String) throws {
        func walk(_ value: Any) -> Any {
            if var object = value as? JSONObject { for (key, child) in object { object[key] = walk(child) }; if object["id"] as? String == id && object["title"] != nil { object["coverUrl"] = url }; return object }
            if let array = value as? [Any] { return array.map(walk) }; return value
        }
        lock.lock(); defer { lock.unlock() }; try set("personal", walk(data["personal"] ?? [:]))
    }
}

private extension Dictionary where Key == String, Value == Any {
    func mapValuesWithKeys(_ transform: ((key: String, value: Any)) -> Any) -> JSONObject { Dictionary(uniqueKeysWithValues: map { ($0.key, transform($0)) }) }
}
