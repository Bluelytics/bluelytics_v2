// The server side of alerts on Apple devices: the website keeps each device's APNs token and sends
// alerts straight through APNs. The UIKit and UserNotifications glue is `ApplePush` in the app.
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Which APNs the token belongs to: development builds get sandbox tokens.
public enum APNsEnvironment: String, Sendable {
    case production
    case sandbox
}

/// One HTTP request with a body; `URLSessionClient` in the app, a fake in tests.
public protocol HTTPSender: Sendable {
    /// Status code and body. Throws on a transport error or a timeout.
    func send(_ method: String, _ url: URL, headers: [String: String], body: Data?, timeout: TimeInterval) async throws -> (status: Int, body: Data)
}

extension URLSessionClient: HTTPSender {
    public func send(_ method: String, _ url: URL, headers: [String: String], body: Data?, timeout: TimeInterval) async throws -> (status: Int, body: Data) {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        request.httpBody = body
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        return try await withCheckedThrowingContinuation { continuation in
            session.dataTask(with: request) { data, response, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ((response as? HTTPURLResponse)?.statusCode ?? 0, data ?? Data()))
                }
            }.resume()
        }
    }
}

public struct PushError: Error, CustomStringConvertible, Equatable {
    public let message: String

    public init(_ message: String) { self.message = message }

    public var description: String { "PushError: \(message)" }
}

/// A device token as APNs and the server expect it: lowercase hex.
public func hexToken(_ token: Data) -> String {
    token.map { byte in
        let hex = String(byte, radix: 16)
        return byte < 16 ? "0" + hex : hex
    }.joined()
}

/// The `aps-environment` of the provisioning profile Xcode embeds in development and ad hoc builds
/// (`embedded.mobileprovision`: a signed envelope around an XML plist). App Store builds carry no
/// profile, so `nil` data means production.
public func apnsEnvironment(provisioningProfile: Data?) -> APNsEnvironment {
    guard let data = provisioningProfile,
          let start = data.range(of: Data("<?xml".utf8)),
          let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex)
    else { return .production }
    let xml = data.subdata(in: start.lowerBound..<end.upperBound)
    guard let plist = try? PropertyListSerialization.propertyList(from: xml, options: [], format: nil) as? [String: Any],
          let entitlements = plist["Entitlements"] as? [String: Any],
          let value = entitlements["aps-environment"] as? String
    else { return .production }
    return value == "development" ? .sandbox : .production
}

/// Registers and unregisters a device token with the website.
public final class PushRegistrar: Sendable {
    public let client: HTTPSender
    public let url: URL
    public let timeout: TimeInterval

    public init(client: HTTPSender = URLSessionClient(), url: URL = URL(string: pushAppleURL)!, timeout: TimeInterval = 12) {
        self.client = client
        self.url = url
        self.timeout = timeout
    }

    private struct Registration: Encodable {
        let token: String
        let environment: String?
    }

    /// `POST {"token", "environment"}`; the server answers 204. Anything else is a failure.
    public func register(token: String, environment: APNsEnvironment) async throws {
        try await call("POST", Registration(token: token, environment: environment.rawValue))
    }

    /// `DELETE {"token"}`; 204 also when the server did not know the token.
    public func unregister(token: String) async throws {
        try await call("DELETE", Registration(token: token, environment: nil))
    }

    private func call(_ method: String, _ registration: Registration) async throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let body = try encoder.encode(registration)
        let response: (status: Int, body: Data)
        do {
            response = try await client.send(
                method,
                url,
                headers: [
                    "content-type": "application/json",
                    "accept": "application/json",
                    "user-agent": "Bluelytics-App/\(appVersion) (iOS)",
                ],
                body: body,
                timeout: timeout
            )
        } catch {
            throw PushError("\(method): \(error)")
        }
        guard (200..<300).contains(response.status) else { throw PushError("\(method): HTTP \(response.status)") }
    }
}
