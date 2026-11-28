// swift-tools-version:5.9
// Everything of the app that does not draw: formats, API models, series and chart maths, the
// calculator, the strings, the HTTP client, the disk cache, the store, settings and the alerts
// logic. Foundation only, so it builds and is tested on Linux as well as on a Mac:
//
//   swift test --package-path apps/ios/BluelyticsCore
//   LIVE=1 swift test --package-path apps/ios/BluelyticsCore --filter LiveAPITests
import PackageDescription

let package = Package(
    name: "BluelyticsCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "BluelyticsCore", targets: ["BluelyticsCore"]),
    ],
    targets: [
        // Tools version 5.9: the Swift 5 language mode, as in the app target.
        .target(name: "BluelyticsCore"),
        .testTarget(
            name: "BluelyticsCoreTests",
            dependencies: ["BluelyticsCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
