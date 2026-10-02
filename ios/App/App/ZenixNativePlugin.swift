import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers
import AVFoundation
import ImageIO

@objc(ZenixNativePlugin)
public final class ZenixNativePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "ZenixNativePlugin"
    public let jsName = "ZenixNative"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "invoke", returnType: CAPPluginReturnPromise)]
    private var store: ZenixStore?, sources: ZenixSources?, playback: ZenixPlayback?, startupError: Error?
    private let worker = DispatchQueue(label: "zenix.native.commands")
    private var pickerCall: CAPPluginCall?, pickerAction = ""
    public override func load() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            do {
                let storage = try ZenixStore(), source = try ZenixSources(storage), player = try ZenixPlayback(store: storage, sources: source)
                store = storage; sources = source; playback = player
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
            if ["pickSource", "pickBackground", "pickLocal"].contains(action) { presentPicker(action, call); return }
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
                            case "importUrl": value = try sources.importURL(args["url"] as? String ?? "")
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
        let types: [UTType] = action == "pickSource" ? [.item] : action == "pickBackground" ? [.image, .movie] : [.audio, UTType(filenameExtension: "lrc") ?? .plainText]
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
                if action == "pickSource", let file = urls.first {
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
