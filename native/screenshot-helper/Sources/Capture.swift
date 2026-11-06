import AppKit
import CoreGraphics
import ScreenCaptureKit

enum ScreenGrab {
  struct Frame {
    let screen: NSScreen
    let image: NSImage
    let cgImage: CGImage
  }

  static func allDisplays() async throws -> [Frame] {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    var frames: [Frame] = []
    for screen in NSScreen.screens {
      let id = displayId(of: screen)
      guard let display = content.displays.first(where: { $0.displayID == id }) else { continue }
      let cgImage = try await image(of: display, screen: screen)
      let nsImage = NSImage(cgImage: cgImage, size: screen.frame.size)
      frames.append(Frame(screen: screen, image: nsImage, cgImage: cgImage))
    }
    if frames.isEmpty { throw CaptureError.noDisplay }
    return frames
  }

  private static func displayId(of screen: NSScreen) -> CGDirectDisplayID {
    (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? CGMainDisplayID()
  }

  private static func image(of display: SCDisplay, screen: NSScreen) async throws -> CGImage {
    let scale = screen.backingScaleFactor
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let config = SCStreamConfiguration()
    config.width = max(display.width, Int(screen.frame.width * scale))
    config.height = max(display.height, Int(screen.frame.height * scale))
    config.showsCursor = false
    config.pixelFormat = kCVPixelFormatType_32BGRA
    config.colorSpaceName = CGColorSpace.sRGB
    if #available(macOS 14.2, *) {
      config.captureResolution = .best
    }
    return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
  }
}

enum CaptureError: Error {
  case noDisplay
}
