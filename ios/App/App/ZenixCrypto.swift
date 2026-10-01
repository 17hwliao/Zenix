import Foundation
import CommonCrypto
import Security
import zlib

enum SourceCrypto {
    static func run(_ action: String, _ args: JSONObject) throws -> JSONObject {
        let input = Data(base64Encoded: args["buffer"] as? String ?? "") ?? Data()
        switch action {
        case "md5":
            var output = [UInt8](repeating: 0, count: Int(CC_MD5_DIGEST_LENGTH))
            _ = input.withUnsafeBytes { CC_MD5($0.baseAddress, CC_LONG(input.count), &output) }
            return ["value": output.map { String(format: "%02x", $0) }.joined()]
        case "randomBytes":
            let count = args["size"] as? Int ?? 0; guard (0...4096).contains(count) else { throw failure("随机字节长度无效") }
            var output = [UInt8](repeating: 0, count: count)
            guard SecRandomCopyBytes(kSecRandomDefault, count, &output) == errSecSuccess else { throw failure("随机数生成失败") }; return ["bytes": Data(output).base64EncodedString()]
        case "aesEncrypt":
            let key = Data(base64Encoded: args["key"] as? String ?? "") ?? Data(), iv = Data(base64Encoded: args["iv"] as? String ?? "") ?? Data()
            let mode = (args["mode"] as? String ?? "").uppercased(), ecb = mode.contains("ECB")
            guard [16, 24, 32].contains(key.count), ecb || iv.count == 16, mode.contains("CBC") || ecb else { throw failure("AES 参数无效") }
            let capacity = input.count + 16
            var output = [UInt8](repeating: 0, count: capacity), written = 0
            let status = key.withUnsafeBytes { keyBytes in iv.withUnsafeBytes { ivBytes in input.withUnsafeBytes { inputBytes in
                CCCrypt(CCOperation(kCCEncrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding | (ecb ? kCCOptionECBMode : 0)), keyBytes.baseAddress, key.count, ecb ? nil : ivBytes.baseAddress, inputBytes.baseAddress, input.count, &output, capacity, &written)
            } } }
            guard status == kCCSuccess else { throw failure("AES 加密失败") }; return ["bytes": Data(output.prefix(written)).base64EncodedString()]
        case "rsaEncrypt":
            let pem = args["key"] as? String ?? ""
            let encoded = pem.components(separatedBy: .newlines).filter { !$0.hasPrefix("-----") }.joined()
            guard let data = Data(base64Encoded: encoded) else { throw failure("RSA 公钥无效") }
            var error: Unmanaged<CFError>?
            let attributes: [CFString: Any] = [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPublic]
            let keyData = stripSPKI(data)
            guard let key = SecKeyCreateWithData(keyData as CFData, attributes as CFDictionary, &error) else { throw failure("RSA 公钥解析失败") }
            let size = SecKeyGetBlockSize(key); guard input.count <= size else { throw failure("RSA 输入过长") }
            let padded = Data(repeating: 0, count: size - input.count) + input
            guard let output = SecKeyCreateEncryptedData(key, .rsaEncryptionRaw, padded as CFData, &error) else { throw failure("RSA 加密失败") }; return ["bytes": (output as Data).base64EncodedString()]
        default: throw failure("不支持的加密方法")
        }
    }
    // Security consumes PKCS#1; most source scripts supply SPKI public keys.
    private static func stripSPKI(_ data: Data) -> Data {
        let bytes = [UInt8](data); var offset = 0
        func length() -> Int? {
            guard offset < bytes.count else { return nil }; let first = Int(bytes[offset]); offset += 1
            if first < 128 { return first }; let count = first & 127
            guard count > 0, count <= 4, offset + count <= bytes.count else { return nil }
            var size = 0; for _ in 0..<count { size = size * 256 + Int(bytes[offset]); offset += 1 }; return size
        }
        guard bytes.first == 0x30 else { return data }; offset = 1
        guard length() != nil, offset < bytes.count, bytes[offset] == 0x30 else { return data }
        offset += 1; guard let algorithmSize = length(), offset + algorithmSize < bytes.count else { return data }; offset += algorithmSize
        guard bytes[offset] == 0x03 else { return data }; offset += 1
        guard let size = length(), size > 1, offset + size <= bytes.count, bytes[offset] == 0 else { return data }; offset += 1
        return Data(bytes[offset..<(offset + size - 1)])
    }
    static func compress(_ action: String, _ encoded: String) throws -> String {
        guard let input = Data(base64Encoded: encoded), input.count <= 4 * 1024 * 1024 else { throw failure("压缩数据无效") }
        var stream = z_stream(), output = Data(), chunk = [UInt8](repeating: 0, count: 32768)
        let inflating = action == "inflate"
        let initial = inflating ? inflateInit2_(&stream, 47, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) : deflateInit_(&stream, Z_DEFAULT_COMPRESSION, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
        guard initial == Z_OK else { throw failure("无法初始化压缩器") }
        defer { if inflating { inflateEnd(&stream) } else { deflateEnd(&stream) } }
        try input.withUnsafeBytes { bytes in
            stream.next_in = UnsafeMutablePointer(mutating: bytes.bindMemory(to: UInt8.self).baseAddress); stream.avail_in = uInt(input.count)
            var status: Int32 = Z_OK
            repeat {
                status = chunk.withUnsafeMutableBytes { buffer in stream.next_out = buffer.bindMemory(to: UInt8.self).baseAddress; stream.avail_out = uInt(buffer.count); return inflating ? inflate(&stream, Z_NO_FLUSH) : deflate(&stream, Z_FINISH) }
                guard status == Z_OK || status == Z_STREAM_END else { throw failure("压缩数据格式不支持") }
                output.append(contentsOf: chunk.prefix(chunk.count - Int(stream.avail_out))); guard output.count <= 4 * 1024 * 1024 else { throw failure("解压内容过大") }
            } while status != Z_STREAM_END
        }
        return output.base64EncodedString()
    }
}
