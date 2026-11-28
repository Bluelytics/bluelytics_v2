// A JSON value read without assumptions about its shape, so the parsers in Models.swift can turn
// a missing or malformed field into `nil` instead of failing the whole body (as the Dart app did
// with `jsonDecode` and type checks).
import Foundation

public enum JSON: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    /// Throws when `data` is not JSON at all.
    public static func parse(_ data: Data) throws -> JSON {
        try JSONDecoder().decode(JSON.self, from: data)
    }

    public static func parse(_ text: String) throws -> JSON {
        try parse(Data(text.utf8))
    }

    public subscript(key: String) -> JSON? {
        if case .object(let fields) = self { return fields[key] }
        return nil
    }

    public var string: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    public var number: Double? {
        if case .number(let value) = self { return value }
        return nil
    }

    /// The number when it is a whole one (JSON has a single number type; the API writes ids and
    /// hundredths without a fraction).
    public var int: Int? {
        guard case .number(let value) = self, value.isFinite, value.rounded() == value, Swift.abs(value) < 9.0e15 else { return nil }
        return Int(value)
    }

    public var array: [JSON]? {
        if case .array(let values) = self { return values }
        return nil
    }

    public var isObject: Bool {
        if case .object = self { return true }
        return false
    }
}

extension JSON: Decodable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Double.self) {
            // Numbers before booleans: some decoders read 1 and 0 as booleans otherwise.
            self = .number(value)
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSON].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSON].self))
        }
    }
}
