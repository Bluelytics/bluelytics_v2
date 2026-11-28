// HTTP access to the public API. Bodies come back as text: the store caches them as received and
// parses them with Models.swift.
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// What the app reads, and from where.
public enum Feed: String, CaseIterable, Sendable {
    /// Live quotes: blue, official and both euros.
    case latest
    /// The last ~45 days with data (the endpoint counts rows: two per day).
    case recent
    /// Every day since 2011 (about 30 kB compressed).
    case full
    /// Units of every currency per US dollar.
    case currencies
    /// The last alert.
    case alert
    /// Reference rates published by third parties (MEP, CCL, …). Optional: served by the website.
    case extras

    public var url: String {
        switch self {
        case .latest: return "\(apiBase)/v2/latest"
        case .recent: return "\(apiBase)/v2/evolution.json?days=90"
        case .full: return "\(apiBase)/v2/evolution.json"
        case .currencies: return "\(apiBase)/data/json/currency.json"
        case .alert: return "\(apiBase)/v2/alerts"
        case .extras: return "\(siteBase)/data/extras.json"
        }
    }
}

public struct APIError: Error, CustomStringConvertible, Sendable {
    public let message: String

    public init(_ message: String) { self.message = message }

    public var description: String { "APIError: \(message)" }
}

/// The one HTTP call the app makes: a GET. `URLSessionClient` in the app, a fixture server in tests.
public protocol HTTPClient: Sendable {
    /// Status code and body. Throws on a transport error or a timeout.
    func get(_ url: URL, headers: [String: String], timeout: TimeInterval) async throws -> (status: Int, body: Data)
}

public final class URLSessionClient: HTTPClient, @unchecked Sendable {
    private let session: URLSession

    public init(session: URLSession = .shared) { self.session = session }

    public func get(_ url: URL, headers: [String: String], timeout: TimeInterval) async throws -> (status: Int, body: Data) {
        var request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: timeout)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        // The completion-handler form: it exists on every platform this package builds for.
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

public final class BluelyticsAPI: Sendable {
    public let client: HTTPClient
    public let timeout: TimeInterval

    public init(client: HTTPClient = URLSessionClient(), timeout: TimeInterval = 12) {
        self.client = client
        self.timeout = timeout
    }

    /// The response body of a feed; throws `APIError` on a network error, a timeout or a non-200 status.
    public func fetch(_ feed: Feed) async throws -> String {
        let response: (status: Int, body: Data)
        do {
            response = try await client.get(
                URL(string: feed.url)!,
                headers: ["accept": "application/json", "user-agent": "Bluelytics-App/\(appVersion) (iOS)"],
                timeout: timeout
            )
        } catch {
            throw APIError("\(feed.rawValue): \(error)")
        }
        guard response.status == 200 else { throw APIError("\(feed.rawValue): HTTP \(response.status)") }
        guard let text = String(data: response.body, encoding: .utf8) else { throw APIError("\(feed.rawValue): not UTF-8") }
        return text
    }
}
