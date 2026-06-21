//
//  AppDelegate.swift
//  macOS (App)
//
//  Created by Alexander Skula on 6/21/26.
//

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.async {
            for window in NSApplication.shared.windows {
                window.minSize = NSSize(width: 420, height: 320)
                window.setContentSize(NSSize(width: 520, height: 360))
                window.center()
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

}
