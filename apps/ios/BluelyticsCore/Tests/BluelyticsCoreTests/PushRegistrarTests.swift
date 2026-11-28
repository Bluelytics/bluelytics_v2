import Foundation
import XCTest
@testable import BluelyticsCore

/// Records each request and answers with `status`, or throws when `status` is nil.
private final class FakeSender: HTTPSender, @unchecked Sendable {
    struct Request {
        let method: String
        let url: URL
        let headers: [String: String]
        let body: [String: String]
    }

    var status: Int?
    private let lock = NSLock()
    private var log: [Request] = []

    init(status: Int?) { self.status = status }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    var requests: [Request] { locked { log } }

    struct Offline: Error {}

    func send(_ method: String, _ url: URL, headers: [String: String], body: Data?, timeout: TimeInterval) async throws -> (status: Int, body: Data) {
        let fields = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] } ?? [:]
        let status = locked { () -> Int? in
            log.append(Request(method: method, url: url, headers: headers, body: fields))
            return self.status
        }
        guard let status else { throw Offline() }
        return (status, Data())
    }
}

final class PushRegistrarTests: XCTestCase {
    let token = "a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0"

    func testRegisterPostsTheTokenAndEnvironmentAsJSON() async throws {
        let sender = FakeSender(status: 204)
        try await PushRegistrar(client: sender).register(token: token, environment: .sandbox)
        let request = try XCTUnwrap(sender.requests.first)
        XCTAssertEqual(sender.requests.count, 1)
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.url.absoluteString, "https://bluelytics.com.ar/app/push/apple")
        XCTAssertEqual(request.headers["content-type"], "application/json")
        XCTAssertEqual(request.headers["user-agent"], "Bluelytics-App/\(appVersion) (iOS)")
        XCTAssertEqual(request.body, ["token": token, "environment": "sandbox"])

        try await PushRegistrar(client: sender).register(token: token, environment: .production)
        XCTAssertEqual(sender.requests.last?.body["environment"], "production")
    }

    func testUnregisterDeletesWithTheTokenOnly() async throws {
        let sender = FakeSender(status: 204)
        try await PushRegistrar(client: sender).unregister(token: token)
        XCTAssertEqual(sender.requests.first?.method, "DELETE")
        XCTAssertEqual(sender.requests.first?.url.absoluteString, pushAppleURL)
        XCTAssertEqual(sender.requests.first?.body, ["token": token])
    }

    func testAnythingButSuccessIsAFailure() async {
        for status in [400, 404, 429, 500, 503] as [Int?] + [nil] {
            let sender = FakeSender(status: status)
            let registrar = PushRegistrar(client: sender)
            do {
                try await registrar.register(token: token, environment: .production)
                XCTFail("register succeeded on \(String(describing: status))")
            } catch {
                XCTAssertTrue(error is PushError, "\(error)")
            }
            do {
                try await registrar.unregister(token: token)
                XCTFail("unregister succeeded on \(String(describing: status))")
            } catch {
                XCTAssertTrue(error is PushError, "\(error)")
            }
        }
    }

    func testTokensAreLowercaseHex() {
        XCTAssertEqual(hexToken(Data([0x00, 0x0f, 0xa0, 0xff, 0x7b])), "000fa0ff7b")
        XCTAssertEqual(hexToken(Data()), "")
        XCTAssertEqual(hexToken(Data(repeating: 0xab, count: 32)).count, 64)
    }

    func testTheEnvironmentComesFromTheEmbeddedProvisioningProfile() {
        func profile(_ aps: String?) -> Data {
            let entitlement = aps.map { "<key>aps-environment</key><string>\($0)</string>" } ?? ""
            let xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0"><dict>
            <key>Name</key><string>iOS Team Provisioning Profile: com.bluelytics.mobile</string>
            <key>Entitlements</key><dict>\(entitlement)<key>application-identifier</key><string>9AGK8J3LYF.com.bluelytics.mobile</string></dict>
            </dict></plist>
            """
            // The plist sits inside a binary CMS envelope.
            return Data([0x30, 0x82, 0x4e, 0x1f, 0x06, 0x09, 0x00, 0xff]) + Data(xml.utf8) + Data([0xa0, 0x82, 0x00, 0x00, 0xff])
        }
        XCTAssertEqual(apnsEnvironment(provisioningProfile: profile("development")), .sandbox)
        XCTAssertEqual(apnsEnvironment(provisioningProfile: profile("production")), .production)
        XCTAssertEqual(apnsEnvironment(provisioningProfile: profile(nil)), .production)
        XCTAssertEqual(apnsEnvironment(provisioningProfile: nil), .production, "App Store builds carry no profile")
        XCTAssertEqual(apnsEnvironment(provisioningProfile: Data("garbage".utf8)), .production)
    }
}
