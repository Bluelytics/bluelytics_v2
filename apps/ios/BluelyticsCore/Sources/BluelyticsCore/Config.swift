// Build-time constants: hosts, links and identifiers.
import Foundation

/// Marketing version; equal to MARKETING_VERSION in the Xcode project (a test checks it).
public let appVersion = "2.0.0"

/// The public API (apps/api): the same endpoints every third-party consumer uses.
public let apiBase = "https://api.bluelytics.com.ar"

/// The website (apps/web), used for links and for the optional `/data/extras.json`.
public let siteBase = "https://bluelytics.com.ar"

/// FCM topic the alert sender uses (packages/core/src/alerts.ts `FCM`).
public let alertsTopic = "alertas-blue"

/// The app's bundle id; the React Native app kept its storage under it (see `legacyAlertsEnabled`).
public let bundleId = "com.bluelytics.mobile"

public enum Links {
    public static let site = siteBase
    public static let about = "\(siteBase)/acerca"
    public static let aboutEn = "\(siteBase)/en/about"
    public static let api = "\(siteBase)/api"
    public static let apiEn = "\(siteBase)/en/api"
    public static let source = "https://github.com/Bluelytics/bluelytics_v2"
    public static let license = "https://creativecommons.org/licenses/by/4.0/"
    public static let x = "https://x.com/bluelytics"
    public static let instagram = "https://www.instagram.com/bluelytics_dolar"
    public static let linkedin = "https://www.linkedin.com/company/74483029"
}
