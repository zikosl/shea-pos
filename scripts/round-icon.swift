import AppKit

guard CommandLine.arguments.count == 3 else {
  fatalError("Usage: round-icon.swift <input> <output>")
}

let input = CommandLine.arguments[1]
let output = CommandLine.arguments[2]
guard let image = NSImage(contentsOfFile: input) else {
  fatalError("Unable to read source icon")
}

let size = image.size
let canvas = NSImage(size: size)
canvas.lockFocus()
NSColor.clear.setFill()
NSRect(origin: .zero, size: size).fill()
// Match the platform-standard rounded-square silhouette used by desktop apps.
let radius = min(size.width, size.height) * 0.22
NSBezierPath(roundedRect: NSRect(origin: .zero, size: size), xRadius: radius, yRadius: radius).addClip()
NSGraphicsContext.current?.imageInterpolation = .high
image.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .sourceOver, fraction: 1)
canvas.unlockFocus()

guard
  let tiff = canvas.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiff),
  let png = bitmap.representation(using: .png, properties: [:])
else {
  fatalError("Unable to encode rounded icon")
}
try png.write(to: URL(fileURLWithPath: output), options: .atomic)
