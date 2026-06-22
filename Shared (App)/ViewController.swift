//
//  ViewController.swift
//  Shared (App)
//

import SafariServices
import WebKit

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
typealias PlatformViewController = NSViewController
#endif

private let extensionBundleIdentifier = "app.freedirect.Freedirect.Extension"

final class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {
    @IBOutlet private weak var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: "controller")
        loadBoilerplatePage()
    }

    private func loadBoilerplatePage() {
        guard let url = Bundle.main.url(forResource: "Main", withExtension: "html", subdirectory: "Base.lproj") else { return }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent().deletingLastPathComponent())
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
#if os(macOS)
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, _ in
            DispatchQueue.main.async { self.show(platform: "mac", enabled: state?.isEnabled, useSettingsInsteadOfPreferences: true) }
        }
#else
        show(platform: "ios", enabled: nil, useSettingsInsteadOfPreferences: false)
#endif
    }

    private func show(platform: String, enabled: Bool?, useSettingsInsteadOfPreferences: Bool) {
        let enabledArgument = enabled.map { $0 ? "true" : "false" } ?? "undefined"
        webView.evaluateJavaScript("show('\(platform)', \(enabledArgument), \(useSettingsInsteadOfPreferences ? "true" : "false"));")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let command = message.body as? String else { return }
        switch command {
        case "open-preferences":
            openPreferences()
        case "open-extension-settings":
            openExtensionSettings()
        default:
            break
        }
    }

    private func openPreferences() {
#if os(macOS)
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in
            DispatchQueue.main.async { NSApplication.shared.terminate(nil) }
        }
#endif
    }

    private func openExtensionSettings() {
#if os(iOS)
        let urlStrings = [
            "settings-navigation://com.apple.Settings.Apps/com.apple.mobilesafari/WEB_EXTENSIONS/Freedirect",
            "settings-navigation://com.apple.Settings.Apps/com.apple.mobilesafari/WEB_EXTENSIONS",
            "App-Prefs:SAFARI&path=WEB_EXTENSIONS/Freedirect",
            "App-Prefs:SAFARI&path=WEB_EXTENSIONS",
            UIApplication.openSettingsURLString
        ]
        openFirstAvailableURL(from: urlStrings.compactMap(URL.init(string:)))
#endif
    }

#if os(iOS)

    private func openFirstAvailableURL(from urls: [URL]) {
        guard let url = urls.first else { return }
        UIApplication.shared.open(url, options: [:]) { success in
            if !success {
                self.openFirstAvailableURL(from: Array(urls.dropFirst()))
            }
        }
    }
#endif
}
