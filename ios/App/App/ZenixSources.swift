import Foundation

final class ZenixSources {
    private let store: ZenixStore, directory: URL
    private let lock = NSRecursiveLock()
    private var previews: [String: JSONObject] = [:], active: ZenixScript?, activeID = "", catalogue: ZenixScript?
    private var matches: [String: JSONObject] = [:]
    private let platforms = ["kw", "kg", "wy", "tx", "mg"]
    init(_ store: ZenixStore) throws {
        self.store = store; directory = store.directory.appendingPathComponent("sources", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    func list() -> [JSONObject] { store.value("sources") as? [JSONObject] ?? [] }
    private func find(_ id: String) throws -> JSONObject {
        guard let source = list().first(where: { $0["id"] as? String == id }) else { throw failure("请先配置音乐源") }; return source
    }
    private func catalog(_ method: String, _ payload: [Any]) throws -> Any {
        lock.lock(); defer { lock.unlock() }
        if catalogue == nil { let engine = ZenixScript(script: "", info: [:], hosts: nil, catalogue: true); _ = try engine.waitReady(); catalogue = engine }
        do { return try catalogue!.call("catalog:" + method, payload) } catch { catalogue?.close(); catalogue = nil; throw error }
    }
    private func invoke(_ source: JSONObject, _ method: String, _ payload: Any) throws -> Any {
        lock.lock(); defer { lock.unlock() }
        let id = source["id"] as? String ?? ""
        if active == nil || id != activeID {
            active?.close(); active = nil; activeID = ""
            let bytes = try Data(contentsOf: directory.appendingPathComponent(id + ".json"))
            guard let pack = try JSONSerialization.jsonObject(with: bytes) as? JSONObject, let script = pack["script"] as? String else { throw failure("音乐源文件无效") }
            let engine = ZenixScript(script: script, info: metadata(script), hosts: source["kind"] as? String == "lx" ? nil : network(source, "apiHosts"))
            _ = try engine.waitReady(); active = engine; activeID = id
        }
        do { return try active!.call(method, payload, settings: source["settings"] as? JSONObject ?? [:]) }
        catch { active?.close(); active = nil; activeID = ""; throw error }
    }
    func preview(_ text: String, origin: String, kind originKind: String) throws -> JSONObject {
        lock.lock(); defer { lock.unlock() }
        guard text.utf8.count <= 1_048_576 else { throw failure("音乐源文件不能超过 1 MiB") }
        var pack: JSONObject, manifest: JSONObject; let kind: String
        if text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("{") {
            guard let parsed = try jsonObject(text) as? JSONObject, let value = parsed["manifest"] as? JSONObject, parsed["script"] is String else { throw failure("音乐源包格式无效") }
            pack = parsed; manifest = value; kind = "zenix"
            let id = manifest["id"] as? String ?? ""
            guard id.range(of: "^[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}$", options: .regularExpression) != nil, manifest["schemaVersion"] as? Int == 1 else { throw failure("只支持有效的 Zenix v1 音乐源") }
            guard let network = manifest["network"] as? JSONObject else { throw failure("缺少域名声明") }
            for key in ["apiHosts", "mediaHosts", "artworkHosts"] {
                guard let hosts = network[key] as? [String], hosts.allSatisfy({ $0.range(of: "^(?:\\*\\.)?[a-zA-Z0-9.-]+$", options: .regularExpression) != nil }) else { throw failure("音乐源域名声明无效") }
            }
            let caps = (manifest["capabilities"] as? [String] ?? []).filter { ["search", "resolvePlayback", "lyrics", "artwork"].contains($0) }
            guard caps.contains("search"), caps.contains("resolvePlayback") else { throw failure("音乐源需要搜索及播放解析能力") }; manifest["capabilities"] = caps
            if manifest["settings"] == nil { manifest["settings"] = [] }; if manifest["qualities"] == nil { manifest["qualities"] = ["standard", "high"] }
        } else {
            kind = "lx"; let info = metadata(text)
            manifest = ["id": "script-" + sha((info["name"] as? String ?? "") + "/" + (info["author"] as? String ?? "")).prefix(24), "name": info["name"] ?? "自定义音乐源", "version": info["version"] ?? "1", "capabilities": ["search", "resolvePlayback", "lyrics", "artwork"], "qualities": ["standard", "high", "lossless"], "settings": [], "network": ["apiHosts": [], "mediaHosts": [], "artworkHosts": []]]
            pack = ["script": text]
        }
        guard let name = manifest["name"] as? String, !name.isEmpty, name.count <= 120, manifest["version"] is String, let script = pack["script"] as? String, script.utf8.count <= 1_048_576 else { throw failure("音乐源名称、版本或脚本无效") }
        guard let fields = manifest["settings"] as? [JSONObject], fields.count <= 50 else { throw failure("音乐源设置格式无效") }
        for field in fields {
            guard let key = field["key"] as? String, key.range(of: "^[a-zA-Z0-9_-]{1,80}$", options: .regularExpression) != nil, field["label"] is String, let type = field["type"] as? String, ["text", "select"].contains(type), field["default"] is String else { throw failure("音乐源设置字段无效") }
            if type == "select" { guard let options = field["options"] as? [String], !options.isEmpty, options.count <= 100 else { throw failure("音乐源选项无效") } }
        }
        pack["manifest"] = manifest
        let token = UUID().uuidString
        let result: JSONObject = ["token": token, "kind": kind, "manifest": manifest, "sha256": sha(pack["script"] as? String ?? ""), "origin": ["kind": originKind, "label": origin], "previousVersion": NSNull()]
        if previews.count >= 5 { previews.removeAll() }; var saved = result; saved["pack"] = pack; previews[token] = saved; return result
    }
    func importURL(_ url: String) throws -> JSONObject {
        guard let address = URL(string: url), ["http", "https"].contains(address.scheme ?? ""), address.host != nil, address.user == nil, address.password == nil else { throw failure("请填写 HTTP / HTTPS 音乐源地址") }
        let response = try SourceNetwork.sync(url)
        guard response["status"] as? Int == 200, let bytes = Data(base64Encoded: response["data"] as? String ?? ""), bytes.count <= 1_048_576, let text = String(data: bytes, encoding: .utf8) else { throw failure("音乐源地址返回无效文件") }
        return try preview(text, origin: url, kind: "url")
    }
    func install(_ token: String) throws -> [JSONObject] {
        lock.lock(); defer { lock.unlock() }
        guard let preview = previews[token], var manifest = preview["manifest"] as? JSONObject, var pack = preview["pack"] as? JSONObject, let script = pack["script"] as? String, let id = manifest["id"] as? String else { throw failure("预览已失效，请重新选择音乐源") }
        let kind = preview["kind"] as? String ?? "zenix"
        let candidate = ZenixScript(script: script, info: metadata(script), hosts: kind == "lx" ? nil : ((manifest["network"] as? JSONObject)?["apiHosts"] as? [String] ?? []))
        defer { candidate.close() }; let initialized = try candidate.waitReady()
        if kind == "lx" {
            guard initialized["status"] as? Bool != false else { throw failure(initialized["message"] as? String ?? "音乐源初始化失败") }
            let advertised = initialized["sources"] as? JSONObject ?? [:]; var supported: JSONObject = [:]
            for platform in platforms {
                guard let descriptor = advertised[platform] as? JSONObject, (descriptor["actions"] as? [String] ?? []).contains("musicUrl"), let qualities = descriptor["qualitys"] as? [String], !qualities.isEmpty else { continue }
                supported[platform] = ["name": descriptor["name"] ?? platform, "qualitys": qualities]
            }
            let options = platforms.filter { supported[$0] != nil }; guard let first = options.first else { throw failure("音乐源没有可用播放平台") }
            manifest["lxPlatforms"] = supported; manifest["settings"] = [["key": "lxCatalog", "label": "歌曲目录", "type": "select", "options": options, "default": first]]
        }
        pack["manifest"] = manifest
        var settings: JSONObject = [:]; for field in manifest["settings"] as? [JSONObject] ?? [] { if let key = field["key"] as? String { settings[key] = field["default"] ?? "" } }
        var rows = list(); let index = rows.firstIndex(where: { $0["id"] as? String == id })
        if let index { settings.merge(rows[index]["settings"] as? JSONObject ?? [:]) { _, saved in saved } }
        let descriptor: JSONObject = ["id": id, "kind": kind, "manifest": manifest, "enabled": true, "origin": preview["origin"] ?? [:], "sha256": preview["sha256"] ?? "", "installedAt": index.map { rows[$0]["installedAt"] ?? nowMillis() } ?? nowMillis(), "status": "ready", "lastError": "", "settings": settings]
        try JSONSerialization.data(withJSONObject: pack).write(to: directory.appendingPathComponent(id + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        if let index { rows[index] = descriptor } else { rows.append(descriptor) }; try store.set("sources", rows); previews.removeValue(forKey: token); invalidate(id); return rows
    }
    func update(_ id: String, action: String, args: JSONObject) throws -> [JSONObject] {
        lock.lock(); defer { lock.unlock() }
        var rows = list(); guard let index = rows.firstIndex(where: { $0["id"] as? String == id }) else { throw failure("音乐源不存在") }
        switch action {
        case "remove": rows.remove(at: index)
        case "enable": rows[index]["enabled"] = args["enabled"] as? Bool ?? false
        case "configure": rows[index]["settings"] = args["values"] as? JSONObject ?? [:]
        default: throw failure("未知音乐源操作")
        }
        try store.set("sources", rows); if action == "remove" { try? FileManager.default.removeItem(at: directory.appendingPathComponent(id + ".json")) }; invalidate(id); return rows
    }
    private func invalidate(_ id: String) { if activeID == id { active?.close(); active = nil; activeID = "" }; matches.removeAll() }
    func search(_ id: String, keyword: String, cursor: String) throws -> JSONObject {
        lock.lock(); defer { lock.unlock() }
        let source = try find(id); guard source["enabled"] as? Bool == true else { throw failure("音乐源已停用") }
        let raw: Any
        if source["kind"] as? String == "lx" {
            let manifest = source["manifest"] as? JSONObject ?? [:], supported = manifest["lxPlatforms"] as? JSONObject ?? [:]
            guard let platform = (source["settings"] as? JSONObject)?["lxCatalog"] as? String ?? platforms.first(where: { supported[$0] != nil }) else { throw failure("没有可用歌曲目录") }
            raw = try catalog("search", [platform, keyword, max(1, Int(cursor) ?? 1), 25])
        } else { raw = try invoke(source, "search", ["keyword": keyword, "cursor": cursor.isEmpty ? NSNull() : cursor as Any, "pageSize": 25]) }
        let result = raw as? JSONObject ?? [:]; var tracks: [JSONObject] = []
        for var row in (result["items"] as? [JSONObject] ?? []).prefix(100) {
            guard let remote = row["remoteId"] as? String, !remote.isEmpty, let title = row["title"] as? String, !title.isEmpty else { continue }
            row["id"] = id + ":" + sha(remote).prefix(24); row["providerId"] = id; row["source"] = "custom"; row["path"] = ""; row["audioUrl"] = ""
            if row["duration"] == nil { row["duration"] = 0 }; if row["artist"] == nil { row["artist"] = "" }
            if let cover = row["coverUrl"] as? String, (try? SourceNetwork.validate(cover, hosts: source["kind"] as? String == "lx" ? nil : network(source, "artworkHosts"))) == nil { row.removeValue(forKey: "coverUrl") }
            tracks.append(row)
        }
        return ["items": tracks, "nextCursor": result["nextCursor"] ?? NSNull()]
    }
    func artwork(_ track: JSONObject) throws -> JSONObject {
        let source = try find(track["providerId"] as? String ?? "")
        let raw: Any
        if source["kind"] as? String == "lx" { raw = try catalog("artwork", [info(track)]) }
        else { raw = try invoke(source, "artwork", ["remoteId": track["remoteId"] ?? ""]) }
        let text = (raw as? JSONObject)?["url"] as? String ?? raw as? String ?? ""
        if text.isEmpty { return [:] }; let url = text.replacingOccurrences(of: "http://", with: "https://")
        _ = try SourceNetwork.validate(url, hosts: source["kind"] as? String == "lx" ? nil : network(source, "artworkHosts")); return ["url": url]
    }
    func lyrics(_ track: JSONObject) throws -> Any {
        if track["source"] as? String == "local" {
            let path = track["path"] as? String ?? ""; let sidecar = URL(fileURLWithPath: path).deletingPathExtension().appendingPathExtension("lrc")
            if let text = try? String(contentsOf: sidecar, encoding: .utf8) { return ["text": text, "format": "lrc", "source": "sidecar"] }; return NSNull()
        }
        let directory = store.directory.appendingPathComponent("lyrics", isDirectory: true); try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let cached = directory.appendingPathComponent(sha(track["id"] as? String ?? "") + ".json")
        if let data = try? Data(contentsOf: cached), let value = try? JSONSerialization.jsonObject(with: data) { return value }
        let source = try find(track["providerId"] as? String ?? "")
        var value: Any
        if source["kind"] as? String == "lx" { value = try catalog("lyrics", [info(track)]) }
        else { value = try invoke(source, "lyrics", ["remoteId": track["remoteId"] ?? ""]) }
        if let text = value as? String { value = ["text": text, "format": "lrc", "source": "custom"] }
        if var object = value as? JSONObject { object["source"] = "custom"; value = object; let data = try JSONSerialization.data(withJSONObject: object); if data.count < 512 * 1024 { try? data.write(to: cached, options: .atomic) }
            let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
            for file in files.sorted(by: { ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) < ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }).prefix(max(0, files.count - 100)) { try? FileManager.default.removeItem(at: file) }
        }
        return value
    }
    func resolve(_ track: JSONObject, attempts: inout Set<String>, quality: String, cancelled: () -> Bool, progress: (String, String) -> Void) throws -> JSONObject {
        let original = try? find(track["providerId"] as? String ?? "")
        for source in list() where source["enabled"] as? Bool == true {
            if cancelled() { throw failure("播放请求已取消") }
            let id = source["id"] as? String ?? ""; var candidate = track
            progress(attempts.isEmpty ? "connecting" : "switching", "正在寻找可用音乐资源")
            do {
                let supported = (source["manifest"] as? JSONObject)?["lxPlatforms"] as? JSONObject ?? [:]
                let originalInfo = try? info(track), originalPlatform = originalInfo?["source"] as? String ?? ""
                let sharedPlatform = source["kind"] as? String == "lx" && original?["kind"] as? String == "lx" && supported[originalPlatform] != nil
                if id != (track["providerId"] as? String ?? "") && !sharedPlatform {
                    let key = (track["id"] as? String ?? "") + ":" + id
                    lock.lock(); let saved = matches[key]; lock.unlock()
                    if let saved { candidate = saved }
                    else {
                        guard !attempts.contains(id + ":match") else { continue }; attempts.insert(id + ":match")
                        let rows = try search(id, keyword: (track["title"] as? String ?? "") + " " + (track["artist"] as? String ?? ""), cursor: "")["items"] as? [JSONObject] ?? []
                        guard let match = rows.first(where: { normalized($0["title"]) == normalized(track["title"]) && normalized($0["artist"]) == normalized(track["artist"]) }) else { continue }; candidate = match
                        lock.lock(); if matches.count >= 32 { matches.removeAll() }; matches[key] = match; lock.unlock()
                    }
                }
                for rawQuality in quality == "lossless" ? ["flac", "320k", "128k"] : ["320k", "128k", "flac"] {
                    if cancelled() { throw failure("播放请求已取消") }
                    let attempt = id + ":" + rawQuality; guard !attempts.contains(attempt) else { continue }; attempts.insert(attempt)
                    let normalized = rawQuality == "flac" ? "lossless" : rawQuality == "320k" ? "high" : "standard"
                    do {
                        progress("resolving", "正在获取音频，失败时自动继续尝试")
                        let raw: Any
                        if source["kind"] as? String == "lx" {
                            let music = try info(candidate), platform = music["source"] as? String ?? ""
                            guard let entry = supported[platform] as? JSONObject, (entry["qualitys"] as? [String] ?? []).contains(rawQuality) else { continue }
                            raw = try invoke(source, "lx", ["source": platform, "action": "musicUrl", "info": ["type": rawQuality, "musicInfo": music]])
                        } else {
                            guard ((source["manifest"] as? JSONObject)?["qualities"] as? [String] ?? []).contains(normalized) else { continue }
                            raw = try invoke(source, "resolvePlayback", ["remoteId": candidate["remoteId"] ?? "", "quality": normalized])
                        }
                        var result = raw as? JSONObject ?? ["url": raw]
                        _ = try SourceNetwork.validate(result["url"] as? String ?? "", hosts: source["kind"] as? String == "lx" ? nil : network(source, "mediaHosts"))
                        result["quality"] = normalized; result["providerId"] = id
                        if source["kind"] as? String != "lx" { result["allowedHosts"] = network(source, "mediaHosts") }; return result
                    } catch { progress("retrying", "当前资源未就绪，继续尝试") }
                }
            } catch { if cancelled() { throw error }; progress("switching", "正在尝试下一个资源") }
        }
        throw failure("全部资源暂不可用，请检查网络或更换音乐源")
    }
    private func network(_ source: JSONObject, _ key: String) -> [String] { ((source["manifest"] as? JSONObject)?["network"] as? JSONObject)?[key] as? [String] ?? [] }
    private func normalized(_ value: Any?) -> String { (value as? String ?? "").lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).joined() }
    private func info(_ track: JSONObject) throws -> JSONObject {
        var encoded = (track["remoteId"] as? String ?? "").replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/"); encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded), data.count <= 65536, let object = try JSONSerialization.jsonObject(with: data) as? JSONObject else { throw failure("歌曲信息无效") }; return object
    }
    private func metadata(_ script: String) -> JSONObject {
        var info: JSONObject = ["rawScript": script]
        for field in ["name", "author", "description", "version", "homepage"] {
            let regex = try? NSRegularExpression(pattern: "^\\s*\\*\\s*@" + field + "\\s+(.+)$", options: [.anchorsMatchLines, .caseInsensitive])
            if let match = regex?.firstMatch(in: script, range: NSRange(script.startIndex..., in: script)), let range = Range(match.range(at: 1), in: script) { info[field] = String(script[range]).trimmingCharacters(in: .whitespaces) }
            else { info[field] = field == "name" ? "自定义音乐源" : field == "version" ? "1" : "" }
        }
        return info
    }
}
