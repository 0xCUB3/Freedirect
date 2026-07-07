//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//

import Foundation
import SafariServices
import os.log

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(iOS 17.0, macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        os_log(.default, "Freedirect native message: %@ (profile: %@)", String(describing: message), profile?.uuidString ?? "none")

        let responsePayload = handle(message: message, profile: profile)
        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: responsePayload]
        } else {
            response.userInfo = ["message": responsePayload]
        }
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    private func handle(message: Any?, profile: UUID?) -> [String: Any] {
        guard let dictionary = message as? [String: Any] else {
            return ["ok": false, "error": "Expected dictionary message"]
        }

        switch dictionary["type"] as? String {
        case "ping":
            return [
                "ok": true,
                "platform": platformName,
                "profile": profile?.uuidString ?? NSNull(),
                "receivedAt": ISO8601DateFormatter().string(from: Date())
            ]
        case "capabilities":
            return [
                "ok": true,
                "platform": platformName,
                "capabilities": [
                    "nativeMessaging",
                    "extensionStateCheck",
                    "activationDiagnostics",
                    "icloudSync"
                ]
            ]
        case "syncGet":
            return SyncStore.shared.read()
        case "syncPut":
            return SyncStore.shared.write(envelope: dictionary["payload"] as? [String: Any], updatedAt: dictionary["updatedAt"] as? String)
        case "syncRemove":
            return SyncStore.shared.remove()
        case "syncStatus":
            return SyncStore.shared.status()
        default:
            return ["ok": false, "error": "Unsupported native message"]
        }
    }

    private var platformName: String {
#if os(iOS)
        return "iOS"
#elseif os(macOS)
        return "macOS"
#else
        return "unknown"
#endif
    }
}

/// iCloud-backed mirror of the extension's `freedirectState` blob.
///
/// `NSUbiquitousKeyValueStore` is the transport: small, key-value, automatic
/// cross-device propagation tied to the user's iCloud account. The appex talks
/// to it directly — no container-app round trip — because extensions can use
/// the KV store as long as the `com.apple.developer.ubiquity-kvstore-identifier`
/// entitlement is present on the appex target. When iCloud is unavailable
/// (no account, no entitlement, quota exceeded) the store still works locally
/// but stops propagating; that surfaces as `available: false` to the JS layer,
/// which then skips pushes but keeps local state intact.
final class SyncStore {
    static let shared = SyncStore()

    private let store = NSUbiquitousKeyValueStore.default
    private let payloadKey = "freedirect.state.payload.v1"
    private let updatedAtKey = "freedirect.state.updatedAt.v1"
    private let originKey = "freedirect.state.origin.v1"

    private let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private init() {
        // Pull any cloud changes that arrived while the appex was suspended.
        // Best-effort; the periodic poll in background.js is the real safety net.
        store.synchronize()
    }

    func read() -> [String: Any] {
        guard isAvailable else {
            return ["ok": true, "available": false, "payload": NSNull(), "cloudUpdatedAt": NSNull(), "cloudOrigin": NSNull()]
        }
        let payloadData = store.data(forKey: payloadKey)
        let updatedAt = store.string(forKey: updatedAtKey)
        let origin = store.string(forKey: originKey)
        let payload: Any
        if let data = payloadData {
            payload = (try? JSONSerialization.jsonObject(with: data, options: [])) ?? NSNull()
        } else {
            payload = NSNull()
        }
        return [
            "ok": true,
            "available": true,
            "payload": payload,
            "cloudUpdatedAt": updatedAt ?? NSNull(),
            "cloudOrigin": origin ?? NSNull()
        ]
    }

    func write(envelope: [String: Any]?, updatedAt: String?) -> [String: Any] {
        guard isAvailable else {
            return ["ok": true, "available": false, "written": false]
        }
        guard let envelope = envelope else {
            return ["ok": false, "error": "Missing payload"]
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: envelope, options: [])
            store.set(data, forKey: payloadKey)
            if let updatedAt = updatedAt {
                store.set(updatedAt, forKey: updatedAtKey)
            } else {
                store.set(isoFormatter.string(from: Date()), forKey: updatedAtKey)
            }
            if let origin = envelope["originDevice"] as? String {
                store.set(origin, forKey: originKey)
            }
            let synced = store.synchronize()
            return ["ok": true, "available": true, "written": synced, "cloudUpdatedAt": store.string(forKey: updatedAtKey) ?? NSNull()]
        } catch {
            return ["ok": false, "error": String(error.localizedDescription)]
        }
    }

    func remove() -> [String: Any] {
        guard isAvailable else {
            return ["ok": true, "available": false, "removed": false]
        }
        store.removeObject(forKey: payloadKey)
        store.removeObject(forKey: updatedAtKey)
        store.removeObject(forKey: originKey)
        let synced = store.synchronize()
        return ["ok": true, "available": true, "removed": synced]
    }

    func status() -> [String: Any] {
        return [
            "ok": true,
            "available": isAvailable,
            "cloudUpdatedAt": store.string(forKey: updatedAtKey) ?? NSNull(),
            "cloudOrigin": store.string(forKey: originKey) ?? NSNull()
        ]
    }

    /// Whether the iCloud KV store is actually reachable: a non-nil
    /// `ubiquityIdentityToken` means an iCloud account is signed in and the
    /// appex carries the `com.apple.developer.ubiquity-kvstore-identifier`
    /// entitlement. The OS enforces the entitlement at the framework level
    /// (writes succeed locally under a signed-out account but don't propagate),
    /// so there's no separate entitlement probe here. `Bundle.main`
    /// Info.plist lookups do not reach code-signed entitlements and would
    /// report `false` unconditionally.
    private var isAvailable: Bool {
        FileManager.default.ubiquityIdentityToken != nil
    }
}