import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers
import AVFoundation
import ImageIO
import Security

@objc(ZenixNativePlugin)
public final class ZenixNativePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "ZenixNativePlugin"
    public let jsName = "ZenixNative"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "invoke", returnType: CAPPluginReturnPromise)]
    private var store: ZenixStore?, sources: ZenixSources?, playback: ZenixPlayback?, startupError: Error?
    private var updates: ZenixAppUpdates?
    private let worker = DispatchQueue(label: "zenix.native.commands")
    private var pickerCall: CAPPluginCall?, pickerAction = ""
    public override func load() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            do {
                let storage = try ZenixStore(), source = try ZenixSources(storage), player = try ZenixPlayback(store: storage, sources: source)
                store = storage; sources = source; playback = player
                updates = try ZenixAppUpdates()
                player.onChange = { [weak self] in self?.broadcast() }
                player.onTick = { [weak self] in guard let self, let player = playback else { return }; notifyListeners("snapshot", data: ["playback": player.tickSnapshot()]) }
            } catch { startupError = error }
        }
    }
    private func snapshot() -> JSONObject {
        guard let store, let playback else { return [:] }; let data = store.read()
        return ["playback": playback.snapshot(), "personal": data["personal"] ?? [:], "sources": data["sources"] ?? [], "cache": playback.cache.stats(), "profile": data["profile"] ?? [:], "appearance": data["appearance"] ?? ["completed": false, "background": NSNull()], "localTracks": data["localTracks"] ?? []]
    }
    private func broadcast() { notifyListeners("snapshot", data: snapshot()) }
    @objc public func invoke(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let store, let sources, let playback else { call.reject(self?.startupError?.localizedDescription ?? "原生服务尚未初始化，请重试"); return }
            let action = call.getString("action") ?? "", args = call.getObject("payload") ?? [:]
            if action == "updates" {
                guard let updates else { call.reject("更新服务尚未初始化"); return }
                updates.invoke(args) { result in DispatchQueue.main.async { switch result { case .success(let value): call.resolve(["value": value]); case .failure(let error): call.reject(error.localizedDescription) } } }; return
            }
            if ["pickSource", "pickSourceBundle", "pickBackground", "pickLocal"].contains(action) { presentPicker(action, call); return }
            do {
                switch action {
                case "snapshot": call.resolve(["value": snapshot()])
                case "notifications": call.resolve(["value": true]) // Control Center needs no notification authorization.
                case "play": try playback.play(args["tracks"] as? [JSONObject] ?? [], index: args["index"] as? Int ?? 0); call.resolve(["value": snapshot()])
                case "toggle": try playback.toggle(); call.resolve(["value": snapshot()])
                case "seek": playback.seek(args["seconds"] as? Double ?? 0); call.resolve(["value": snapshot()])
                case "next", "previous": playback.next(action == "next" ? 1 : -1); call.resolve(["value": snapshot()])
                case "mode": try playback.mode(args); call.resolve(["value": snapshot()])
                case "removeQueue": try playback.remove(args["id"] as? String ?? ""); call.resolve(["value": snapshot()])
                case "cacheConfigure": try playback.cache.configure(args); broadcast(); call.resolve(["value": snapshot()])
                case "cacheClear": try playback.clearCache(); call.resolve(["value": snapshot()])
                case "overlayEnable", "overlayConfigure": throw failure("iOS 使用应用内歌词与锁屏播放控制，不支持跨应用悬浮窗")
                default:
                    worker.async { [weak self] in
                        guard let self else { call.reject("原生服务已结束"); return }
                        do {
                            let value: Any
                            switch action {
                            case "search": value = try sources.search(args["id"] as? String ?? "", keyword: args["keyword"] as? String ?? "", cursor: args["cursor"] as? String ?? "")
                            case "artwork":
                                let track = args["track"] as? JSONObject ?? [:], result = try sources.artwork(track)
                                if let url = result["url"] as? String { try store.artwork(track["id"] as? String ?? "", url) }; value = result
                            case "lyrics": value = try sources.lyrics(args["track"] as? JSONObject ?? [:])
                            case "sourceDigest":
                                let text = args["text"] as? String ?? ""
                                guard text.utf8.count <= 512 * 1024 else { throw failure("脚本不能超过 512 KiB") }; value = sha(text)
                            case "importUrl": value = try sources.importURL(args["url"] as? String ?? "")
                            case "previewSourceText":
                                let origin = args["url"] as? String ?? ""
                                let localSource = args["originKind"] as? String == "file"
                                if localSource {
                                    guard !origin.isEmpty, origin.count <= 240 else { throw failure("本地源文件名无效") }
                                } else {
                                    guard let address = URL(string: origin), ["http", "https"].contains(address.scheme ?? ""), address.host != nil, address.user == nil, address.password == nil else { throw failure("分享源地址无效") }
                                }
                                value = try sources.preview(args["text"] as? String ?? "", origin: origin, kind: localSource ? "file" : "url")
                            case "install": value = try sources.install(args["token"] as? String ?? "")
                            case "sourceEnable", "sourceRemove", "sourceConfigure": value = try sources.update(args["id"] as? String ?? "", action: action == "sourceEnable" ? "enable" : action == "sourceRemove" ? "remove" : "configure", args: args)
                            case "personal": value = try store.personal(args["operation"] as? String ?? "", args)
                            case "profile":
                                var profile = store.value("profile") as? JSONObject ?? [:]
                                for key in ["name", "bio", "email", "lyricColor"] { if let text = args[key] as? String { profile[key] = String(text.prefix(key == "bio" ? 120 : 80)) } }
                                if let size = args["lyricSize"] as? Double { profile["lyricSize"] = min(38, max(18, size)) }; try store.set("profile", profile); value = profile
                            case "clearBackground":
                                let old = (store.value("appearance") as? JSONObject)?["background"] as? JSONObject
                                try store.set("appearance", ["completed": true, "background": NSNull()])
                                if let path = old?["url"] as? String, path.hasPrefix(store.directory.appendingPathComponent("background").path + "/") { try? FileManager.default.removeItem(atPath: path) }; value = true
                            case "completeWelcome": var appearance = store.value("appearance") as? JSONObject ?? ["background": NSNull()]; appearance["completed"] = true; try store.set("appearance", appearance); value = appearance
                            case "licenses":
                                let base = Bundle.main.bundleURL.appendingPathComponent("zenix/legal")
                                let files = [base.appendingPathComponent("LICENSE"), base.appendingPathComponent("THIRD_PARTY_NOTICES.md")] + ((try? FileManager.default.contentsOfDirectory(at: base.appendingPathComponent("licenses"), includingPropertiesForKeys: nil)) ?? [])
                                value = files.compactMap { try? String(contentsOf: $0, encoding: .utf8) }.joined(separator: "\n\n")
                            default: throw failure("未实现的 iOS 操作：" + action)
                            }
                            DispatchQueue.main.async { [weak self] in if !["search", "lyrics", "importUrl", "licenses"].contains(action) { self?.broadcast() }; call.resolve(["value": value]) }
                        } catch { DispatchQueue.main.async { call.reject(error.localizedDescription) } }
                    }
                }
            } catch { call.reject(error.localizedDescription) }
        }
    }
    private func presentPicker(_ action: String, _ call: CAPPluginCall) {
        guard pickerCall == nil, let controller = bridge?.viewController, controller.presentedViewController == nil else { call.reject("请先关闭当前文件选择窗口"); return }
        let types: [UTType] = ["pickSource", "pickSourceBundle"].contains(action) ? [.item] : action == "pickBackground" ? [.image, .movie] : [.audio, UTType(filenameExtension: "lrc") ?? .plainText]
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        picker.allowsMultipleSelection = action == "pickLocal"; picker.delegate = self; pickerCall = call; pickerAction = action; controller.present(picker, animated: true)
    }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { pickerCall?.resolve(["value": NSNull()]); pickerCall = nil }
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickerCall, let store, let sources else { return }; let action = pickerAction; pickerCall = nil
        worker.async { [weak self] in
            guard let self else { call.reject("原生服务已结束"); return }
            do {
                var value: Any = NSNull()
                if action == "pickSourceBundle", let file = urls.first {
                    let scope = file.startAccessingSecurityScopedResource(); defer { if scope { file.stopAccessingSecurityScopedResource() } }
                    guard let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 0, size <= 8 * 1024 * 1024 else { throw failure("分享源包为空或超过 8 MiB") }
                    let bytes = try Data(contentsOf: file)
                    guard bytes.count <= 8 * 1024 * 1024 else { throw failure("分享源包不能超过 8 MiB") }
                    value = ["name": file.lastPathComponent, "base64": bytes.base64EncodedString()]
                } else if action == "pickSource", let file = urls.first {
                    guard ["js", "zenixsource", "json"].contains(file.pathExtension.lowercased()) else { throw failure("请选择 .js 或 .zenixsource 文件") }
                    guard (try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 1_048_576 else { throw failure("音乐源文件不能超过 1 MiB") }
                    value = try sources.preview(String(contentsOf: file, encoding: .utf8), origin: file.lastPathComponent, kind: "file")
                } else if action == "pickBackground", let file = urls.first {
                    let location = try copy(file, folder: "background", limit: 256 * 1024 * 1024, preserveName: false)
                    let kind = UTType(filenameExtension: file.pathExtension)?.conforms(to: .movie) == true ? "video" : "image"
                    let old = (store.value("appearance") as? JSONObject)?["background"] as? JSONObject
                    let appearance: JSONObject = ["completed": true, "background": ["kind": kind, "name": file.lastPathComponent, "url": location.path]]
                    try store.set("appearance", appearance); value = appearance
                    if let path = old?["url"] as? String, path.hasPrefix(store.directory.appendingPathComponent("background").path + "/") { try? FileManager.default.removeItem(atPath: path) }
                } else if action == "pickLocal" {
                    var tracks = store.value("localTracks") as? [JSONObject] ?? []
                    // Import sidecars first, regardless of the picker selection order.
                    for file in urls where file.pathExtension.lowercased() == "lrc" { _ = try copy(file, folder: "local", limit: 512 * 1024, preserveName: true) }
                    for file in urls where file.pathExtension.lowercased() != "lrc" {
                        let location = try copy(file, folder: "local", limit: 512 * 1024 * 1024, preserveName: true)
                        let id = "local:" + sha(location.lastPathComponent), title = file.deletingPathExtension().lastPathComponent
                        var track: JSONObject = ["id": id, "source": "local", "path": location.path, "audioUrl": location.path, "title": title, "artist": "", "duration": 0]
                        // Metadata completion is asynchronous and does not block the source queue.
                        tracks.removeAll { $0["id"] as? String == id }; tracks.append(track)
                        track["id"] = id; enrichLocal(track, location: location)
                    }
                    try store.set("localTracks", tracks); value = tracks
                }
                DispatchQueue.main.async { [weak self] in self?.broadcast(); call.resolve(["value": value]) }
            } catch { DispatchQueue.main.async { call.reject(error.localizedDescription) } }
        }
    }
    private func copy(_ url: URL, folder: String, limit: Int, preserveName: Bool) throws -> URL {
        guard let store else { throw failure("原生存储未初始化") }; let scope = url.startAccessingSecurityScopedResource(); defer { if scope { url.stopAccessingSecurityScopedResource() } }
        guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 0, size <= limit else { throw failure("所选文件为空或超过导入大小上限") }
        let directory = store.directory.appendingPathComponent(folder, isDirectory: true); try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent(preserveName ? url.lastPathComponent : UUID().uuidString + "." + url.pathExtension)
        let temporary = directory.appendingPathComponent(UUID().uuidString + ".import")
        try FileManager.default.copyItem(at: url, to: temporary)
        if FileManager.default.fileExists(atPath: destination.path) { _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary) } else { try FileManager.default.moveItem(at: temporary, to: destination) }; return destination
    }
    private func enrichLocal(_ original: JSONObject, location: URL) {
        Task { [weak self] in
            guard let self else { return }; var track = original; let asset = AVURLAsset(url: location)
            if let duration = try? await asset.load(.duration), duration.seconds.isFinite { track["duration"] = duration.seconds }
            if let rows = try? await asset.load(.commonMetadata) {
                for row in rows {
                    if row.commonKey == .commonKeyTitle, let text = try? await row.load(.stringValue) { track["title"] = text }
                    else if row.commonKey == .commonKeyArtist, let text = try? await row.load(.stringValue) { track["artist"] = text }
                    else if row.commonKey == .commonKeyArtwork, let bytes = try? await row.load(.dataValue), bytes.count <= 2 * 1024 * 1024, let store {
                        let art = store.directory.appendingPathComponent("local").appendingPathComponent(sha(location.lastPathComponent) + ".jpg")
                        if let source = CGImageSourceCreateWithData(bytes as CFData, nil), let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 512] as CFDictionary), let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.85) { try? jpeg.write(to: art, options: .atomic); track["coverUrl"] = art.path }
                    }
                }
            }
            let completed = track
            worker.async { [weak self] in guard let self, let store else { return }; var rows = store.value("localTracks") as? [JSONObject] ?? []; if let index = rows.firstIndex(where: { $0["id"] as? String == completed["id"] as? String }) { rows[index] = completed; try? store.set("localTracks", rows); DispatchQueue.main.async { [weak self] in self?.broadcast() } } }
        }
    }
}

/// iOS keeps installation in Apple's distribution channel; it never downloads an executable replacement.
private final class ZenixAppUpdates {
    private let worker = DispatchQueue(label: "zenix.updates"), lock = NSLock()
    private let config: JSONObject
    private var state: JSONObject, artifact: JSONObject?
    private let build = Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0") ?? 0
    private let hosts = ["raw.githubusercontent.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]
    init() throws {
        let location = Bundle.main.bundleURL.appendingPathComponent("zenix/distribution.json")
        guard let data = try JSONSerialization.jsonObject(with: Data(contentsOf: location)) as? JSONObject else { throw failure("更新配置无效") }
        config = data
        state = ["status": "idle", "currentVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "", "progress": 0, "message": "尚未检查更新"]
    }
    private func snapshot() -> JSONObject { lock.lock(); defer { lock.unlock() }; return state }
    private func set(_ key: String, _ value: Any) { lock.lock(); defer { lock.unlock() }; state[key] = value }
    private func text(_ address: String, restricted: Bool, limit: Int) throws -> String {
        guard let url = URL(string: address), url.scheme == "https", let host = url.host else { throw failure("请使用 HTTPS 地址") }
        let result = try SourceNetwork.sync(address, hosts: restricted ? hosts : hosts + [host])
        let code = result["status"] as? Int ?? 0
        if code == 404 && restricted { throw NSError(domain: "ZenixUpdateFeed", code: 404, userInfo: [NSLocalizedDescriptionKey: "此通道尚未发布更新清单"]) }
        guard code == 200, let encoded = result["data"] as? String, let bytes = Data(base64Encoded: encoded), bytes.count <= limit, let string = String(data: bytes, encoding: .utf8) else { throw failure("分享内容无法读取或超过大小限制") }; return string
    }
    private func check(_ channel: String) throws -> JSONObject {
        guard ["stable", "preview"].contains(channel), let feeds = config["feeds"] as? JSONObject, let url = feeds[channel] as? String else { throw failure("更新通道无效") }
        lock.lock(); state = ["status": "checking", "currentVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "", "progress": 0, "message": "正在检查更新"]; lock.unlock(); artifact = nil
        do {
            guard let envelope = try jsonObject(text(url, restricted: true, limit: 256 * 1024)) as? JSONObject,
                  envelope["format"] as? String == "zenix-signed-release",
                  let payloadText = envelope["payload"] as? String, let bytes = Data(base64Encoded: payloadText),
                  let signatureText = envelope["signature"] as? String, let signature = Data(base64Encoded: signatureText),
                  let publicText = config["publicKeyPkcs1"] as? String, let keyData = Data(base64Encoded: publicText) else { throw failure("更新清单格式错误") }
            var keyError: Unmanaged<CFError>?
            guard let key = SecKeyCreateWithData(keyData as CFData, [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPublic] as CFDictionary, &keyError) else { throw failure("更新公钥无效") }
            var verificationError: Unmanaged<CFError>?
            guard SecKeyVerifySignature(key, .rsaSignatureMessagePKCS1v15SHA256, bytes as CFData, signature as CFData, &verificationError) else { throw failure("发布签名校验失败，已停止更新") }
            guard let manifest = try JSONSerialization.jsonObject(with: bytes) as? JSONObject, manifest["schemaVersion"] as? Int == 1, manifest["channel"] as? String == channel else { throw failure("更新清单格式错误") }
            guard let item = (manifest["artifacts"] as? JSONObject)?["ios"] as? JSONObject else { set("status", "unpublished"); set("message", "当前通道尚未发布 iOS 更新"); return snapshot() }
            guard (item["build"] as? Int ?? 0) > build else { set("status", "current"); set("message", "已是此通道的最新版本"); return snapshot() }
            artifact = item; set("version", item["version"] as? String ?? ""); set("notes", manifest["notes"] as? String ?? ""); set("status", "available"); set("message", "发现新版本，请通过发行渠道更新")
        } catch { set("status", (error as NSError).domain == "ZenixUpdateFeed" ? "unpublished" : "error"); set("message", error.localizedDescription) }
        return snapshot()
    }
    func invoke(_ args: JSONObject, completion: @escaping (Result<Any, Error>) -> Void) {
        let operation = args["operation"] as? String ?? ""
        if operation == "state" { completion(.success(snapshot())); return }
        worker.async { [self] in
            do {
                switch operation {
                case "check": completion(.success(try check(args["channel"] as? String ?? "stable")))
                case "sourceBundle":
                    let requested = args["url"] as? String ?? "", address = requested.isEmpty ? config["managedSourcesUrl"] as? String ?? "" : requested
                    guard !address.isEmpty else { throw failure("尚未配置专用源分享地址，可导入分享包文件或粘贴链接") }
                    completion(.success(try text(address, restricted: false, limit: 4 * 1024 * 1024)))
                case "install":
                    guard snapshot()["status"] as? String == "available", let item = artifact else { throw failure("没有可安装的更新") }
                    let address = item["url"] as? String ?? config["iosDistributionUrl"] as? String ?? ""
                    guard let url = URL(string: address), url.scheme == "https", let host = url.host, ["testflight.apple.com", "apps.apple.com"].contains(host), url.user == nil, url.password == nil else { throw failure("尚未配置 TestFlight 或 App Store 发行地址") }
                    DispatchQueue.main.async { UIApplication.shared.open(url, options: [:]) { opened in completion(opened ? .success(self.snapshot()) : .failure(failure("无法打开发行渠道，请确认 TestFlight 已安装"))) } }
                default: throw failure("iOS 更新由 TestFlight / App Store 安装")
                }
            } catch { completion(.failure(error)) }
        }
    }
}
