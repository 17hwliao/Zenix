import Foundation
import Darwin

enum SourceNetwork {
    static func validate(_ text: String, hosts: [String]? = nil) throws -> URL {
        guard let url = URL(string: text), ["https", "http"].contains(url.scheme?.lowercased() ?? ""), let host = url.host?.lowercased(), url.user == nil, url.password == nil else { throw failure("资源地址无效") }
        guard host != "localhost", !host.hasSuffix(".local"), !host.hasSuffix(".internal") else { throw failure("不允许访问本地网络") }
        if let hosts, url.scheme?.lowercased() != "https" || !hosts.contains(where: { $0.lowercased() == host || ($0.hasPrefix("*.") && host.hasSuffix(String($0.dropFirst()))) }) { throw failure("资源地址需要 HTTPS 且域名必须在音乐源中声明") }
        var hints = addrinfo(); hints.ai_family = AF_UNSPEC; hints.ai_socktype = SOCK_STREAM
        var result: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &result) == 0, let first = result else { throw failure("无法连接资源服务器") }
        defer { freeaddrinfo(first) }
        var cursor: UnsafeMutablePointer<addrinfo>? = first
        while let item = cursor {
            let info = item.pointee
            guard let pointer = info.ai_addr else { throw failure("无法读取资源服务器地址") }
            if info.ai_family == AF_INET {
                let ip = UnsafeRawPointer(pointer).assumingMemoryBound(to: sockaddr_in.self).pointee.sin_addr.s_addr.bigEndian
                let a = ip >> 24, b = (ip >> 16) & 255
                if a == 0 || a == 10 || a == 127 || a >= 224 || (a == 169 && b == 254) || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168) || (a == 100 && (64...127).contains(b)) { throw failure("不允许访问私有网络") }
            } else if info.ai_family == AF_INET6 {
                let address = UnsafeRawPointer(pointer).assumingMemoryBound(to: sockaddr_in6.self).pointee.sin6_addr
                let bytes = withUnsafeBytes(of: address) { Array($0) }
                if bytes.allSatisfy({ $0 == 0 }) || (bytes.prefix(15).allSatisfy({ $0 == 0 }) && bytes[15] == 1) || bytes[0] & 0xfe == 0xfc || (bytes[0] == 0xfe && bytes[1] & 0xc0 == 0x80) || bytes[0] == 0xff { throw failure("不允许访问私有网络") }
                if bytes.prefix(10).allSatisfy({ $0 == 0 }) && bytes[10] == 255 && bytes[11] == 255 {
                    let a = bytes[12], b = bytes[13]
                    if a == 0 || a == 10 || a == 127 || a >= 224 || (a == 169 && b == 254) || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168) || (a == 100 && (64...127).contains(b)) { throw failure("不允许访问私有网络") }
                }
            }
            cursor = info.ai_next
        }
        return url
    }
    static func request(_ text: String, options: JSONObject = [:], hosts: [String]? = nil, completion: @escaping (Result<JSONObject, Error>) -> Void) -> SourceRequest? {
        do {
            let url = try validate(text, hosts: hosts); var request = URLRequest(url: url)
            let method = (options["method"] as? String ?? "GET").uppercased()
            guard ["GET", "POST"].contains(method) else { throw failure("只支持 GET 与 POST 请求") }; request.httpMethod = method
            request.timeoutInterval = min(15, max(2, (options["timeout"] as? Double ?? (options["signal"] as? JSONObject)?["timeout"] as? Double ?? 11000) / 1000))
            request.setValue("Zenix/0.2 iOS", forHTTPHeaderField: "User-Agent")
            for (key, value) in options["headers"] as? JSONObject ?? [:] {
                guard !["host", "content-length", "connection"].contains(key.lowercased()), !key.contains("\n"), !String(describing: value).contains("\n") else { continue }
                request.setValue(String(describing: value), forHTTPHeaderField: key)
            }
            if let form = options["form"] as? JSONObject {
                var parts = URLComponents(); parts.queryItems = form.map { URLQueryItem(name: $0.key, value: String(describing: $0.value)) }
                request.httpBody = Data((parts.percentEncodedQuery ?? "").utf8); request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            } else if let form = options["formData"] as? JSONObject {
                let boundary = "Zenix" + UUID().uuidString; var body = ""
                for (key, value) in form { let safe = key.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "").replacingOccurrences(of: "\"", with: ""); body += "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(safe)\"\r\n\r\n\(value)\r\n" }
                body += "--\(boundary)--\r\n"; request.httpBody = Data(body.utf8); request.setValue("multipart/form-data; boundary=" + boundary, forHTTPHeaderField: "Content-Type")
            } else if let json = options["json"] as? JSONObject { request.httpBody = try JSONSerialization.data(withJSONObject: json); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
            else if let body = options["body"] as? String { request.httpBody = Data(body.utf8) }
            else if let body = options["body"] { request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
            guard (request.httpBody?.count ?? 0) <= 1_048_576 else { throw failure("请求内容过大") }
            let job = SourceRequest(hosts: hosts, completion: completion); job.start(request); return job
        } catch { completion(.failure(error)); return nil }
    }
    static func sync(_ url: String, options: JSONObject = [:], hosts: [String]? = nil) throws -> JSONObject {
        let signal = DispatchSemaphore(value: 0); var output: Result<JSONObject, Error> = .failure(failure("连接超时"))
        let task = request(url, options: options, hosts: hosts) { output = $0; signal.signal() }
        guard signal.wait(timeout: .now() + 20) == .success else { task?.cancel(); throw failure("连接超时") }; return try output.get()
    }
}

final class SourceRequest: NSObject, URLSessionDataDelegate {
    private let hosts: [String]?, completion: (Result<JSONObject, Error>) -> Void
    private var bytes = Data(), response: HTTPURLResponse?, redirects = 0, completed = false
    private var session: URLSession?, task: URLSessionDataTask?
    init(hosts: [String]?, completion: @escaping (Result<JSONObject, Error>) -> Void) { self.hosts = hosts; self.completion = completion }
    func start(_ request: URLRequest) {
        let config = URLSessionConfiguration.ephemeral; config.httpCookieStorage = nil; config.urlCache = nil; config.timeoutIntervalForResource = 18
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: config, delegate: self, delegateQueue: queue); task = session?.dataTask(with: request); task?.resume()
    }
    func cancel() { task?.cancel() }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        redirects += 1
        guard redirects <= 5, let text = request.url?.absoluteString, (try? SourceNetwork.validate(text, hosts: hosts)) != nil else { completionHandler(nil); return }
        var next = request
        if task.currentRequest?.url?.host != request.url?.host { for key in ["Authorization", "Cookie", "Proxy-Authorization"] { next.setValue(nil, forHTTPHeaderField: key) } }
        completionHandler(next)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard response.expectedContentLength <= 4 * 1024 * 1024 else { completionHandler(.cancel); return }; self.response = response as? HTTPURLResponse; completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) { if bytes.count + data.count > 4 * 1024 * 1024 { dataTask.cancel() } else { bytes.append(data) } }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard !completed else { return }; completed = true; defer { session.finishTasksAndInvalidate(); self.session = nil; self.task = nil }
        if let error { completion(.failure(error)); return }
        guard let response else { completion(.failure(failure("无效服务器响应"))); return }
        var headers: [String: String] = [:]; for (key, value) in response.allHeaderFields { headers[String(describing: key).lowercased()] = String(describing: value) }
        completion(.success(["status": response.statusCode, "headers": headers, "data": bytes.base64EncodedString()]))
    }
}
