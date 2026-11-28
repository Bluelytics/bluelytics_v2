// What the person chose and the app must remember.
import Foundation

/// The few values the app saves. `UserDefaults` in the app, `MemoryPreferences` in tests.
public protocol Preferences: AnyObject {
    func string(_ key: String) -> String?
    func bool(_ key: String) -> Bool?
    func set(_ key: String, string: String)
    func set(_ key: String, bool: Bool)
}

public final class MemoryPreferences: Preferences {
    public var values: [String: Any]

    public init(_ values: [String: Any] = [:]) { self.values = values }

    public func string(_ key: String) -> String? { values[key] as? String }
    public func bool(_ key: String) -> Bool? { values[key] as? Bool }
    public func set(_ key: String, string: String) { values[key] = string }
    public func set(_ key: String, bool: Bool) { values[key] = bool }
}

/// `UserDefaults.standard` as `Preferences`; a missing key reads as `nil`, not `false`.
public final class DefaultsPreferences: Preferences {
    private let defaults: UserDefaults

    public init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }

    public func string(_ key: String) -> String? { defaults.string(forKey: key) }
    public func bool(_ key: String) -> Bool? { defaults.object(forKey: key) == nil ? nil : defaults.bool(forKey: key) }
    public func set(_ key: String, string: String) { defaults.set(string, forKey: key) }
    public func set(_ key: String, bool: Bool) { defaults.set(bool, forKey: key) }
}

@MainActor
public final class Settings {
    private static let localeKey = "locale"

    public let prefs: Preferences
    public private(set) var locale: AppLocale
    public var onChange: (() -> Void)?

    /// `deviceLocale` applies until a language is chosen: Spanish on a Spanish-language device,
    /// English everywhere else.
    public init(prefs: Preferences, deviceLocale: AppLocale) {
        self.prefs = prefs
        locale = prefs.string(Settings.localeKey).flatMap(AppLocale.init(rawValue:)) ?? deviceLocale
    }

    /// The device language as the app uses it: `es` for any Spanish, `en` for anything else.
    public static func deviceLocale(preferredLanguages: [String]) -> AppLocale {
        preferredLanguages.first.map { $0.hasPrefix("es") } == true ? .es : .en
    }

    public func setLocale(_ value: AppLocale) {
        guard value != locale else { return }
        locale = value
        prefs.set(Settings.localeKey, string: value.rawValue)
        onChange?()
    }

    public func toggleLocale() { setLocale(locale == .es ? .en : .es) }
}
