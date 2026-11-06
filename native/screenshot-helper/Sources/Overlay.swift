import AppKit
import UniformTypeIdentifiers

struct OverlayStrings {
  let language: String
  var ja: Bool { language == "ja" }
  var drag: String { ja ? "ドラッグして範囲を選択" : "Drag to select an area" }
  var move: String { ja ? "範囲をドラッグして移動、ハンドルでサイズを変更" : "Drag the area to move it, or a handle to resize" }
  var toCapture: String { ja ? "でキャプチャ" : "to capture" }
  var toCancel: String { ja ? "でキャンセル" : "to cancel" }
  var copy: String { ja ? "コピー" : "Copy" }
  var save: String { ja ? "保存" : "Save" }
  var close: String { ja ? "閉じる" : "Close" }
}

enum OverlayResult {
  case cancel
  case copy
  case save
  case edit(Data)
}

final class OverlayController: NSObject {
  private let frames: [ScreenGrab.Frame]
  private let strings: OverlayStrings
  private let pageUrl: String
  private var windows: [OverlayWindow] = []
  private var continuation: CheckedContinuation<OverlayResult, Never>?
  private var finished = false

  init(frames: [ScreenGrab.Frame], language: String, pageUrl: String) {
    self.frames = frames
    self.strings = OverlayStrings(language: language)
    self.pageUrl = pageUrl
  }

  func run() async -> OverlayResult {
    await withCheckedContinuation { continuation in
      self.continuation = continuation
      DispatchQueue.main.async { self.show() }
    }
  }

  func cancel() {
    finish(.cancel)
  }

  private func show() {
    NSApp.setActivationPolicy(.accessory)
    NSApp.activate(ignoringOtherApps: true)
    for frame in frames {
      let window = OverlayWindow(frame: frame, strings: strings, pageUrl: pageUrl) { [weak self] result in
        self?.finish(result)
      }
      windows.append(window)
      window.makeKeyAndOrderFront(nil)
    }
    windows.first?.makeKey()
  }

  private func finish(_ result: OverlayResult) {
    guard !finished else { return }
    finished = true
    windows.forEach { $0.orderOut(nil) }
    windows.removeAll()
    continuation?.resume(returning: result)
    continuation = nil
  }
}

private final class OverlayWindow: NSWindow {
  init(frame: ScreenGrab.Frame, strings: OverlayStrings, pageUrl: String, onFinish: @escaping (OverlayResult) -> Void) {
    super.init(
      contentRect: frame.screen.frame,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    ignoresMouseEvents = false
    acceptsMouseMovedEvents = true
    isReleasedWhenClosed = false
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .transient]
    level = .screenSaver
    setFrame(frame.screen.frame, display: true)
    contentView = OverlayView(frame: frame, strings: strings, pageUrl: pageUrl, onFinish: onFinish)
  }

  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { true }
}

private final class OverlayView: NSView {
  private let shot: ScreenGrab.Frame
  private let strings: OverlayStrings
  private let pageUrl: String
  private let onFinish: (OverlayResult) -> Void

  private var selection: NSRect?
  private var dragStart: NSPoint?
  private var movingFrom: (point: NSPoint, rect: NSRect)?
  private var resizing: (handle: Handle, origin: NSRect)?
  private var ready = false

  private let hint = NSTextField(labelWithString: "")
  private let sizeLabel = NSTextField(labelWithString: "")
  private let copyButton = OverlayButton()
  private let saveButton = OverlayButton()
  private let closeButton = OverlayButton()
  private var handleViews: [Handle: NSView] = [:]

  init(frame: ScreenGrab.Frame, strings: OverlayStrings, pageUrl: String, onFinish: @escaping (OverlayResult) -> Void) {
    self.shot = frame
    self.strings = strings
    self.pageUrl = pageUrl
    self.onFinish = onFinish
    super.init(frame: frame.screen.frame)
    wantsLayer = true
    addSubview(hint)
    addSubview(sizeLabel)
    addSubview(copyButton)
    addSubview(saveButton)
    addSubview(closeButton)
    styleHint()
    styleSize()
    copyButton.title = strings.copy
    copyButton.primary = false
    copyButton.onClick = { [weak self] in self?.copyShot() }
    saveButton.title = strings.save
    saveButton.primary = true
    saveButton.onClick = { [weak self] in self?.saveShot() }
    closeButton.title = strings.close
    closeButton.iconOnly = true
    closeButton.onClick = { [weak self] in self?.onFinish(.cancel) }
    for handle in Handle.allCases {
      let view = HandleView()
      view.handle = handle
      handleViews[handle] = view
      addSubview(view)
    }
    setHint(ready: false)
    hideChrome(true)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    window?.makeFirstResponder(self)
  }

  override func draw(_ dirtyRect: NSRect) {
    shot.image.draw(in: bounds, from: .zero, operation: .copy, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
    let dim = NSColor(srgbRed: 9 / 255, green: 11 / 255, blue: 18 / 255, alpha: 0.5)
    dim.setFill()
    guard let sel = selection, sel.width > 1, sel.height > 1 else {
      bounds.fill()
      return
    }
    NSRect(x: 0, y: 0, width: bounds.width, height: max(0, sel.minY)).fill()
    NSRect(x: 0, y: sel.maxY, width: bounds.width, height: max(0, bounds.height - sel.maxY)).fill()
    NSRect(x: 0, y: sel.minY, width: max(0, sel.minX), height: sel.height).fill()
    NSRect(x: sel.maxX, y: sel.minY, width: max(0, bounds.width - sel.maxX), height: sel.height).fill()
    let border = NSColor(srgbRed: 0x8f / 255, green: 0x80 / 255, blue: 1, alpha: 1)
    border.setStroke()
    let path = NSBezierPath(rect: sel)
    path.lineWidth = 1.5
    path.stroke()
  }

  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    let point = convert(event.locationInWindow, from: nil)
    if let handle = handleAt(point), let sel = selection, ready {
      resizing = (handle, sel)
      return
    }
    if ready, let sel = selection, sel.contains(point) {
      movingFrom = (point, sel)
      return
    }
    ready = false
    hideChrome(true)
    dragStart = point
    selection = nil
    setHint(ready: false)
    needsDisplay = true
  }

  override func mouseDragged(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    if let resizing {
      selection = resize(resizing.origin, resizing.handle, point)
      layoutSelection()
      needsDisplay = true
      return
    }
    if let movingFrom {
      selection = move(movingFrom.rect, by: NSPoint(x: point.x - movingFrom.point.x, y: point.y - movingFrom.point.y))
      layoutSelection()
      needsDisplay = true
      return
    }
    guard let start = dragStart else { return }
    selection = NSRect(x: min(start.x, point.x), y: min(start.y, point.y), width: abs(point.x - start.x), height: abs(point.y - start.y))
    layoutSelection()
    needsDisplay = true
  }

  override func mouseUp(with event: NSEvent) {
    resizing = nil
    movingFrom = nil
    dragStart = nil
    if let sel = selection, sel.width >= 8, sel.height >= 8 {
      ready = true
      hideChrome(false)
      setHint(ready: true)
      layoutSelection()
    } else {
      ready = false
      selection = nil
      hideChrome(true)
      setHint(ready: false)
    }
    needsDisplay = true
  }

  override func keyDown(with event: NSEvent) {
    if event.keyCode == 53 {
      onFinish(.cancel)
      return
    }
    if event.keyCode == 36 || event.keyCode == 76, ready {
      if let data = pngData() { onFinish(.edit(data)) }
      return
    }
    if event.modifierFlags.contains(.command) || event.modifierFlags.contains(.control) {
      if event.charactersIgnoringModifiers == "c" { copyShot(); return }
      if event.charactersIgnoringModifiers == "s" { saveShot(); return }
    }
    super.keyDown(with: event)
  }

  private func copyShot() {
    guard let data = pngData() else { return }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setData(data, forType: .png)
    if let tiff = nsImage()?.tiffRepresentation {
      pasteboard.setData(tiff, forType: .tiff)
    }
    onFinish(.copy)
  }

  private func saveShot() {
    guard let data = pngData() else { return }
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.png]
    panel.nameFieldStringValue = fileName()
    panel.canCreateDirectories = true
    window?.level = .normal
    NSApp.activate(ignoringOtherApps: true)
    panel.begin { [weak self] response in
      guard let self else { return }
      if response == .OK, let url = panel.url {
        try? data.write(to: url)
        self.onFinish(.save)
      } else {
        self.window?.level = .screenSaver
        self.window?.makeKeyAndOrderFront(nil)
      }
    }
  }

  private func pngData() -> Data? {
    guard let image = croppedCGImage() else { return nil }
    let rep = NSBitmapImageRep(cgImage: image)
    return rep.representation(using: .png, properties: [:])
  }

  private func nsImage() -> NSImage? {
    guard let image = croppedCGImage() else { return nil }
    return NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
  }

  private func croppedCGImage() -> CGImage? {
    guard let sel = selection else { return nil }
    let scaleX = CGFloat(shot.cgImage.width) / bounds.width
    let scaleY = CGFloat(shot.cgImage.height) / bounds.height
    var crop = CGRect(
      x: sel.origin.x * scaleX,
      y: sel.origin.y * scaleY,
      width: sel.width * scaleX,
      height: sel.height * scaleY
    ).integral
    crop = crop.intersection(CGRect(x: 0, y: 0, width: shot.cgImage.width, height: shot.cgImage.height))
    guard crop.width >= 1, crop.height >= 1 else { return nil }
    return shot.cgImage.cropping(to: crop)
  }

  private func fileName() -> String {
    let stamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
      .replacingOccurrences(of: ":", with: "")
      .replacingOccurrences(of: " ", with: "-")
    var host = ""
    if let url = URL(string: pageUrl) { host = url.host ?? "" }
    host = host.replacingOccurrences(of: "[^a-zA-Z0-9.-]+", with: "-", options: .regularExpression)
    if host.isEmpty { return "screenshot-\(stamp).png" }
    return "screenshot-\(host)-\(stamp).png"
  }

  private func setHint(ready: Bool) {
    let text = ready
      ? "\(strings.move)  ⏎ \(strings.toCapture)  Esc \(strings.toCancel)"
      : "\(strings.drag)  Esc \(strings.toCancel)"
    hint.stringValue = text
    hint.sizeToFit()
    let width = min(bounds.width - 40, max(320, hint.intrinsicContentSize.width + 28))
    hint.frame = NSRect(x: (bounds.width - width) / 2, y: 18, width: width, height: 36)
  }

  private func styleHint() {
    hint.drawsBackground = true
    hint.backgroundColor = NSColor(srgbRed: 27 / 255, green: 31 / 255, blue: 43 / 255, alpha: 0.96)
    hint.textColor = NSColor(srgbRed: 0xE9 / 255, green: 0xEC / 255, blue: 0xF5 / 255, alpha: 1)
    hint.font = .systemFont(ofSize: 12.5, weight: .semibold)
    hint.alignment = .center
    hint.wantsLayer = true
    hint.layer?.cornerRadius = 12
    hint.layer?.borderWidth = 1
    hint.layer?.borderColor = NSColor.white.withAlphaComponent(0.12).cgColor
  }

  private func styleSize() {
    sizeLabel.drawsBackground = true
    sizeLabel.backgroundColor = NSColor(srgbRed: 27 / 255, green: 31 / 255, blue: 43 / 255, alpha: 0.95)
    sizeLabel.textColor = .white
    sizeLabel.font = .monospacedDigitSystemFont(ofSize: 11.5, weight: .semibold)
    sizeLabel.alignment = .center
    sizeLabel.wantsLayer = true
    sizeLabel.layer?.cornerRadius = 7
  }

  private func hideChrome(_ hidden: Bool) {
    copyButton.isHidden = hidden
    saveButton.isHidden = hidden
    closeButton.isHidden = hidden
    for view in handleViews.values { view.isHidden = hidden }
  }

  private func layoutSelection() {
    guard let sel = selection else {
      sizeLabel.isHidden = true
      return
    }
    sizeLabel.isHidden = false
    sizeLabel.stringValue = "\(Int(sel.width.rounded())) × \(Int(sel.height.rounded()))"
    sizeLabel.sizeToFit()
    let labelSize = NSSize(width: sizeLabel.intrinsicContentSize.width + 16, height: 22)
    let below = sel.maxY + 8 + labelSize.height <= bounds.height
    sizeLabel.frame = NSRect(
      x: min(max(4, sel.minX), bounds.width - labelSize.width - 4),
      y: below ? sel.maxY + 8 : max(4, sel.minY - 30),
      width: labelSize.width,
      height: labelSize.height
    )
    let barY = min(bounds.height - 54, max(8, sel.maxY + 12))
    let barW: CGFloat = 280
    var barX = sel.midX - barW / 2
    barX = min(max(8, barX), bounds.width - barW - 8)
    copyButton.frame = NSRect(x: barX, y: barY, width: 90, height: 34)
    saveButton.frame = NSRect(x: barX + 96, y: barY, width: 90, height: 34)
    closeButton.frame = NSRect(x: barX + 196, y: barY, width: 34, height: 34)
    let size: CGFloat = 10
    handleViews[.nw]?.frame = NSRect(x: sel.minX - size / 2, y: sel.minY - size / 2, width: size, height: size)
    handleViews[.n]?.frame = NSRect(x: sel.midX - size / 2, y: sel.minY - size / 2, width: size, height: size)
    handleViews[.ne]?.frame = NSRect(x: sel.maxX - size / 2, y: sel.minY - size / 2, width: size, height: size)
    handleViews[.e]?.frame = NSRect(x: sel.maxX - size / 2, y: sel.midY - size / 2, width: size, height: size)
    handleViews[.se]?.frame = NSRect(x: sel.maxX - size / 2, y: sel.maxY - size / 2, width: size, height: size)
    handleViews[.s]?.frame = NSRect(x: sel.midX - size / 2, y: sel.maxY - size / 2, width: size, height: size)
    handleViews[.sw]?.frame = NSRect(x: sel.minX - size / 2, y: sel.maxY - size / 2, width: size, height: size)
    handleViews[.w]?.frame = NSRect(x: sel.minX - size / 2, y: sel.midY - size / 2, width: size, height: size)
  }

  private func handleAt(_ point: NSPoint) -> Handle? {
    for (handle, view) in handleViews where !view.isHidden && view.frame.insetBy(dx: -6, dy: -6).contains(point) {
      return handle
    }
    return nil
  }

  private func move(_ rect: NSRect, by delta: NSPoint) -> NSRect {
    var next = rect.offsetBy(dx: delta.x, dy: delta.y)
    next.origin.x = min(max(0, next.origin.x), bounds.width - next.width)
    next.origin.y = min(max(0, next.origin.y), bounds.height - next.height)
    return next
  }

  private func resize(_ origin: NSRect, _ handle: Handle, _ point: NSPoint) -> NSRect {
    var x1 = origin.minX
    var y1 = origin.minY
    var x2 = origin.maxX
    var y2 = origin.maxY
    if handle.hasW { x1 = min(x2 - 8, max(0, point.x)) }
    if handle.hasE { x2 = max(x1 + 8, min(bounds.width, point.x)) }
    if handle.hasN { y1 = min(y2 - 8, max(0, point.y)) }
    if handle.hasS { y2 = max(y1 + 8, min(bounds.height, point.y)) }
    return NSRect(x: x1, y: y1, width: x2 - x1, height: y2 - y1)
  }
}

private enum Handle: CaseIterable {
  case nw, n, ne, e, se, s, sw, w
  var hasW: Bool { self == .nw || self == .w || self == .sw }
  var hasE: Bool { self == .ne || self == .e || self == .se }
  var hasN: Bool { self == .nw || self == .n || self == .ne }
  var hasS: Bool { self == .sw || self == .s || self == .se }
}

private final class HandleView: NSView {
  var handle: Handle = .se
  override func draw(_ dirtyRect: NSRect) {
    NSColor.white.setFill()
    bounds.fill()
    NSColor(srgbRed: 0x8f / 255, green: 0x80 / 255, blue: 1, alpha: 1).setStroke()
    let path = NSBezierPath(rect: bounds.insetBy(dx: 0.75, dy: 0.75))
    path.lineWidth = 1.5
    path.stroke()
  }
}

private final class OverlayButton: NSView {
  var title = "" { didSet { needsDisplay = true } }
  var primary = false { didSet { needsDisplay = true } }
  var iconOnly = false
  var onClick: (() -> Void)?
  private var hover = false

  override var isFlipped: Bool { true }

  override func draw(_ dirtyRect: NSRect) {
    let bg: NSColor
    if primary {
      bg = NSColor(srgbRed: 0x7c / 255, green: 0x6c / 255, blue: 0xf6 / 255, alpha: 1)
    } else if hover {
      bg = NSColor.white.withAlphaComponent(0.16)
    } else {
      bg = NSColor.white.withAlphaComponent(0.09)
    }
    bg.setFill()
    NSBezierPath(roundedRect: bounds, xRadius: 10, yRadius: 10).fill()
    let text = iconOnly ? "✕" : title
    let color: NSColor = primary ? .white : NSColor(srgbRed: 0xF1 / 255, green: 0xF3 / 255, blue: 0xFA / 255, alpha: 1)
    let attrs: [NSAttributedString.Key: Any] = [
      .font: NSFont.systemFont(ofSize: 12.5, weight: .semibold),
      .foregroundColor: color,
    ]
    let size = (text as NSString).size(withAttributes: attrs)
    let point = NSPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2)
    (text as NSString).draw(at: point, withAttributes: attrs)
  }

  override func mouseEntered(with event: NSEvent) { hover = true; needsDisplay = true }
  override func mouseExited(with event: NSEvent) { hover = false; needsDisplay = true }
  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    trackingAreas.forEach(removeTrackingArea)
    addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil))
  }

  override func mouseDown(with event: NSEvent) {}
  override func mouseUp(with event: NSEvent) {
    if bounds.contains(convert(event.locationInWindow, from: nil)) { onClick?() }
  }
}
