import AppKit
import Foundation

@main
struct AssistantCodePreviewSmoke {
    @MainActor
    static func main() async throws {
        let manager = FileManager.default
        let temporary = manager.temporaryDirectory.appending(path: "bxb-code-preview-\(UUID().uuidString)")
        let workspace = temporary.appending(path: "workspace")
        let previews = workspace.appending(path: "Code Previews")
        try manager.createDirectory(at: previews, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: temporary) }

        let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: 2, pixelsHigh: 2,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        )!
        let png = bitmap.representation(using: .png, properties: [:])!
        try png.write(to: previews.appending(path: "example.png"))
        try Data("not an image".utf8).write(to: previews.appending(path: "corrupted.png"))
        try png.write(to: temporary.appending(path: "outside.png"))
        try manager.createSymbolicLink(
            at: previews.appending(path: "linked.png"), withDestinationURL: temporary.appending(path: "outside.png")
        )

        func preview(_ path: String) -> AssistantPreviewImage {
            AssistantPreviewImage.parse(.object(["relativePath": .string(path)]), index: 0)!
        }

        let loaded = await AssistantCodePreviewLoader.imageData(
            for: preview("Code Previews/example.png"), workspaceDirectory: workspace.path
        )
        precondition(loaded == png)
        precondition(loaded.flatMap { NSImage(data: $0) } != nil)

        let corrupted = await AssistantCodePreviewLoader.imageData(
            for: preview("Code Previews/corrupted.png"), workspaceDirectory: workspace.path
        )
        precondition(corrupted != nil && corrupted.flatMap { NSImage(data: $0) } == nil)

        for path in ["", ".", "Code Previews", "Code Previews/missing.png", "../outside.png", "Code Previews/linked.png", temporary.appending(path: "outside.png").path] {
            let data = await AssistantCodePreviewLoader.imageData(for: preview(path), workspaceDirectory: workspace.path)
            precondition(data == nil, "Unexpectedly loaded \(path)")
        }
        let withoutWorkspace = await AssistantCodePreviewLoader.imageData(for: preview("example.png"), workspaceDirectory: nil)
        precondition(withoutWorkspace == nil)

        print("assistant-code-preview=ok valid-image corrupted-image missing-file workspace-boundary")
    }
}
