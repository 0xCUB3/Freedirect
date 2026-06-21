//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//

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
                    "appGroupStoragePlanned"
                ]
            ]
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
