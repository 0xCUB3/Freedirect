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
        guard (message.body as? String) == "open-preferences" else { return }
#if os(macOS)
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in
            DispatchQueue.main.async { NSApplication.shared.terminate(nil) }
        }
#endif
    }
}
