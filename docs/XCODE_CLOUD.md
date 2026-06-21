# Xcode Cloud

Xcode Cloud cannot be fully enabled from this repository. The workflow itself has to be created in Xcode or App Store Connect for the Apple Developer account.

What is in the repo:

- shared Xcode schemes for the iOS and macOS apps
- `ci_scripts/ci_post_clone.sh`, which prints the Xcode version and runs the lightweight repository verifier when Xcode Cloud checks out the project

Suggested Xcode Cloud setup:

1. Create a new workflow for `Freedirect.xcodeproj` in Xcode or App Store Connect.
2. Use the shared scheme you want to build, usually `Freedirect (iOS)` for App Store/TestFlight or `Freedirect (macOS)` for macOS validation.
3. Configure signing in the Apple Developer portal/App Store Connect.
4. Keep GitHub DMG/Homebrew releases in GitHub Actions; Xcode Cloud is better suited for App Store/TestFlight builds.
