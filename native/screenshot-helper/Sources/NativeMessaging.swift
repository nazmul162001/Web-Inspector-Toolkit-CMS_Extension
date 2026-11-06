import Foundation

enum NativeMessaging {
  static func read() -> [String: Any]? {
    let input = FileHandle.standardInput
    guard let header = readExact(input, 4), header.count == 4 else { return nil }
    let length = header.withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }
    guard length > 0, length < 64 * 1024 * 1024 else { return nil }
    guard let body = readExact(input, Int(length)), body.count == Int(length) else { return nil }
    return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
  }

  static func write(_ object: [String: Any]) {
    guard let body = try? JSONSerialization.data(withJSONObject: object, options: []) else { return }
    var length = UInt32(body.count).littleEndian
    let header = Data(bytes: &length, count: 4)
    FileHandle.standardOutput.write(header)
    FileHandle.standardOutput.write(body)
  }

  private static func readExact(_ handle: FileHandle, _ count: Int) -> Data? {
    var data = Data()
    while data.count < count {
      do {
        guard let chunk = try handle.read(upToCount: count - data.count), !chunk.isEmpty else { return nil }
        data.append(chunk)
      } catch {
        return nil
      }
    }
    return data
  }
}
