import Foundation
import JavaScriptCore

@objc protocol SourceHostExport: JSExport {
    func ready(_ text: String)
    func result(_ text: String)
    func http(_ text: String)
    func crypto(_ text: String) -> String
    func zlib(_ text: String) -> String
    func encode(_ text: String) -> String
    func timer(_ text: String)
    func cancelTimer(_ id: Int)
}
final class SourceHost: NSObject, SourceHostExport {
    weak var engine: ZenixScript?
    func ready(_ text: String) { engine?.ready(text) }
    func result(_ text: String) { engine?.result(text) }
    func http(_ text: String) { engine?.http(text) }
    func crypto(_ text: String) -> String {
        do { let args = try jsonObject(text) as? JSONObject ?? [:]; return try jsonString(SourceCrypto.run(args["action"] as? String ?? "", args["values"] as? JSONObject ?? [:])) }
        catch { return (try? jsonString(["error": error.localizedDescription])) ?? "{}" }
    }
    func zlib(_ text: String) -> String {
        do { let args = try jsonObject(text) as? JSONObject ?? [:]; return try SourceCrypto.compress(args["action"] as? String ?? "", args["data"] as? String ?? "") }
        catch { JSContext.current()?.exception = JSValue(newErrorFromMessage: error.localizedDescription, in: JSContext.current()); return "" }
    }
    func encode(_ input: String) -> String {
        let args = (try? jsonObject(input)) as? JSONObject ?? [:], text = args["text"] as? String ?? "", action = args["action"] as? String ?? ""
        if action == "utf8" { return Data(text.utf8).base64EncodedString() }
        if action == "text" { return String(decoding: Data(base64Encoded: text) ?? Data(), as: UTF8.self) }
        if action == "btoa" { return Data(text.utf16.map { UInt8(truncatingIfNeeded: $0) }).base64EncodedString() }
        if action == "atob", let bytes = Data(base64Encoded: text, options: .ignoreUnknownCharacters) { return String(String.UnicodeScalarView(bytes.map { UnicodeScalar(Int($0))! })) }
        return ""
    }
    func timer(_ text: String) { let args = (try? jsonObject(text)) as? JSONObject ?? [:]; engine?.timer(args["id"] as? Int ?? 0, args["delay"] as? Double ?? 0) }
    func cancelTimer(_ id: Int) { engine?.cancelTimer(id) }
}

/// Scripts have a separate JS VM, no UI, filesystem, cookies or application inventory.
/// Source initialization/calls are bounded; scripts are still trusted user supplied code.
final class ZenixScript {
    private let queue = DispatchQueue(label: "zenix.source.vm"), host = SourceHost()
    private var context: JSContext?, initialization: Result<JSONObject, Error>?, initializationSignal = DispatchSemaphore(value: 0)
    private var sequence = 0, pending: [Int: (Result<Any, Error>) -> Void] = [:], timers: [Int: DispatchWorkItem] = [:], requests: [Int: SourceRequest] = [:], requestedIDs: Set<Int> = []
    private let hosts: [String]?
    init(script: String, info: JSONObject, hosts: [String]?, catalogue: Bool = false) {
        self.hosts = hosts; host.engine = self
        queue.async { [self] in
            let vm = JSContext()!; context = vm; vm.setObject(host, forKeyedSubscript: "__host" as NSString)
            vm.exceptionHandler = { [weak self] _, exception in self?.scriptError(exception?.toString() ?? "音乐源脚本异常") }
            vm.setObject(info, forKeyedSubscript: "__scriptInfo" as NSString)
            vm.setObject(script, forKeyedSubscript: "__rawScript" as NSString)
            vm.evaluateScript(Self.polyfills)
            do {
                for file in catalogue ? ["host", "catalog"] : ["host"] {
                    guard let url = Bundle.main.url(forResource: file, withExtension: "js", subdirectory: "zenix") else { throw failure("缺少音乐源运行组件，请执行 ios:sync") }
                    vm.evaluateScript(try String(contentsOf: url, encoding: .utf8))
                }
                if catalogue { ready("{}") } else { vm.evaluateScript(script, withSourceURL: URL(string: "zenix-source://user/script.js")) }
            } catch { scriptError(error.localizedDescription) }
        }
    }
    func waitReady() throws -> JSONObject {
        guard initializationSignal.wait(timeout: .now() + 18) == .success else { close(); throw failure("音乐源初始化超时") }
        guard let initialization else { throw failure("音乐源未就绪") }; return try initialization.get()
    }
    func call(_ method: String, _ payload: Any, settings: JSONObject = [:]) throws -> Any {
        let signal = DispatchSemaphore(value: 0); var output: Result<Any, Error> = .failure(failure("音乐源调用超时"))
        queue.async { [self] in sequence += 1; let id = sequence; pending[id] = { output = $0; signal.signal() }; context?.objectForKeyedSubscript("__invoke")?.call(withArguments: [id, method, payload, settings]) }
        guard signal.wait(timeout: .now() + 20) == .success else { close(); throw failure("音乐源调用超时") }; return try output.get()
    }
    fileprivate func ready(_ text: String) {
        guard initialization == nil else { return }
        do { initialization = .success(try jsonObject(text) as? JSONObject ?? [:]) } catch { initialization = .failure(error) }; initializationSignal.signal()
    }
    fileprivate func result(_ text: String) {
        guard let value = try? jsonObject(text) as? JSONObject, let id = value["id"] as? Int, let callback = pending.removeValue(forKey: id) else { return }
        if let error = value["error"] as? String { callback(.failure(failure(error))) } else { callback(.success(value["value"] ?? NSNull())) }
    }
    private func scriptError(_ message: String) {
        if initialization == nil { initialization = .failure(failure(message)); initializationSignal.signal() }
        let callbacks = pending.values; pending.removeAll(); for callback in callbacks { callback(.failure(failure(message))) }
    }
    fileprivate func http(_ text: String) {
        guard let value = try? jsonObject(text) as? JSONObject, let id = value["id"] as? Int, let url = value["url"] as? String else { return }
        guard requestedIDs.count < 8 else { context?.objectForKeyedSubscript("__networkResult")?.call(withArguments: [id, NSNull(), "并发请求过多"]); return }; requestedIDs.insert(id)
        // DNS and networking never run on the JS or UI thread.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let job = SourceNetwork.request(url, options: value["options"] as? JSONObject ?? [:], hosts: hosts) { [weak self] result in
                guard let self else { return }; queue.async { [self] in
                    requests.removeValue(forKey: id); requestedIDs.remove(id)
                    switch result { case .success(let data): context?.objectForKeyedSubscript("__networkResult")?.call(withArguments: [id, data, NSNull()]); case .failure(let error): context?.objectForKeyedSubscript("__networkResult")?.call(withArguments: [id, NSNull(), error.localizedDescription]) }
                }
            }
            queue.async { [weak self] in if self?.context != nil && self?.requestedIDs.contains(id) == true { self?.requests[id] = job } else { job?.cancel() } }
        }
    }
    fileprivate func timer(_ id: Int, _ delay: Double) {
        guard timers.count < 32 else { return }; let work = DispatchWorkItem { [weak self] in self?.timers.removeValue(forKey: id); self?.context?.objectForKeyedSubscript("__fireTimer")?.call(withArguments: [id]) }
        timers[id] = work; queue.asyncAfter(deadline: .now() + min(60, max(0.01, delay / 1000)), execute: work)
    }
    fileprivate func cancelTimer(_ id: Int) { timers.removeValue(forKey: id)?.cancel() }
    func close() { queue.async { [self] in for timer in timers.values { timer.cancel() }; timers.removeAll(); for job in requests.values { job.cancel() }; requests.removeAll(); requestedIDs.removeAll(); scriptError("音乐源运行已结束"); context?.exceptionHandler = nil; context = nil } }
    private static let polyfills = """
    globalThis.NativeHost=Object.freeze({ready:s=>__host.ready(s),result:s=>__host.result(s),http:s=>__host.http(s),crypto:s=>__host.crypto(s),zlib:(action,data)=>__host.zlib(JSON.stringify({action,data})),encode:(text,action)=>__host.encode(JSON.stringify({text,action})),timer:(id,delay)=>__host.timer(JSON.stringify({id,delay})),cancelTimer:id=>__host.cancelTimer(id)});
    globalThis.btoa = s => NativeHost.encode(String(s), 'btoa');
    globalThis.atob = s => NativeHost.encode(String(s).replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(String(s).length/4)*4,'='), 'atob');
    globalThis.TextEncoder = class { encode(s) { return Uint8Array.from(atob(NativeHost.encode(String(s),'utf8')), c=>c.charCodeAt(0)); } };
    globalThis.TextDecoder = class { decode(value) { const b = value instanceof Uint8Array ? value : new Uint8Array(value || []); let s=''; for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192)); return NativeHost.encode(btoa(s),'text'); } };
    let timerID=0; const timerCallbacks=new Map();
    globalThis.setTimeout=(callback,delay=0,...args)=>{const id=++timerID;timerCallbacks.set(id,()=>callback(...args));NativeHost.timer(id,Number(delay)||0);return id;};
    globalThis.clearTimeout=id=>{timerCallbacks.delete(id);NativeHost.cancelTimer(id);};
    globalThis.__fireTimer=id=>{const cb=timerCallbacks.get(id);timerCallbacks.delete(id);cb?.();};
    globalThis.AbortSignal={timeout:ms=>({timeout:ms})};
    globalThis.console=Object.freeze({log(){},warn(){},error(){},info(){},debug(){}});
    globalThis.URLSearchParams=class {constructor(value={}){this.rows=Object.entries(value);}append(k,v){this.rows.push([k,v]);}toString(){return this.rows.map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');}};
    globalThis.URL=class {constructor(value){this.href=String(value);const match=this.href.match(/^([a-z]+):[/][/](\\[[^\\]]+\\]|[^/:?#]+)(?::([0-9]+))?([^?#]*)(?:[?]([^#]*))?/i);if(!match)throw Error('Invalid URL');this.protocol=match[1]+':';this.hostname=match[2];this.port=match[3]||'';this.pathname=match[4]||'/';this.search=match[5]?'?'+match[5]:'';this.searchParams=new URLSearchParams();}toString(){return this.href;}};
    """
}
