import AppKit
import Foundation

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var overlay: OverlayController?
  private var capturing = false

  func applicationDidFinishLaunching(_ notification: Notification) {
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      while let message = NativeMessaging.read() {
        DispatchQueue.main.async { self?.handle(message) }
      }
      DispatchQueue.main.async { NSApp.terminate(nil) }
    }
  }

  private func handle(_ message: [String: Any]) {
    let type = message["type"] as? String ?? ""
    if type == "ping" {
      NativeMessaging.write(["ok": true])
      return
    }
    if type == "cancel" {
      overlay?.cancel()
      return
    }
    if type != "capture" { return }
    if capturing { overlay?.cancel() }
    capturing = true
    let language = message["language"] as? String ?? "en"
    let pageUrl = message["pageUrl"] as? String ?? ""
    Task { @MainActor in
      let result: OverlayResult
      do {
        let frames = try await ScreenGrab.allDisplays()
        let controller = OverlayController(frames: frames, language: language, pageUrl: pageUrl)
        self.overlay = controller
        result = await controller.run()
        self.overlay = nil
      } catch {
        NativeMessaging.write([
          "ok": false,
          "code": "CAPTURE_FAILED",
          "message": Self.permissionMessage(language),
        ])
        self.capturing = false
        return
      }
      switch result {
      case .cancel:
        NativeMessaging.write(["ok": true, "action": "cancel"])
      case .copy:
        NativeMessaging.write(["ok": true, "action": "copy"])
      case .save:
        NativeMessaging.write(["ok": true, "action": "save"])
      case .edit(let data):
        NativeMessaging.write(["ok": true, "action": "edit", "png": data.base64EncodedString()])
      }
      self.capturing = false
    }
  }

  private static func permissionMessage(_ language: String) -> String {
    if language == "ja" {
      return "macOSの画面収録を許可してください。システム設定 → プライバシーとセキュリティ → 画面収録 で「Web Inspector Screenshot」をオンにします。"
    }
    return "Allow Screen Recording for Web Inspector Screenshot in System Settings → Privacy & Security → Screen Recording, then try again."
  }
}

let delegate = AppDelegate()
app.delegate = delegate
app.run()
