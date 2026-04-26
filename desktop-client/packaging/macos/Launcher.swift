import AppKit
import Foundation

final class LauncherWindowController: NSWindowController {
    private let statusLabel = NSTextField(labelWithString: "正在准备启动器...")
    private let subtitleLabel = NSTextField(labelWithString: "")
    private let detailView = NSTextView()
    private let spinner = NSProgressIndicator()
    private let closeButton = NSButton(title: "关闭", target: nil, action: nil)
    private let openLogButton = NSButton(title: "打开日志", target: nil, action: nil)
    private let iconView = NSImageView()
    private var logLines: [String] = []
    private var process: Process?
    private let appRoot: URL
    private let logFile: URL

    init(appRoot: URL) {
        self.appRoot = appRoot
        self.logFile = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/BXB Client/launcher.log")

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 430),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "BXB Client"
        window.center()
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        window.toolbarStyle = .unifiedCompact
        super.init(window: window)
        setupUI()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func setupUI() {
        guard let contentView = window?.contentView else { return }
        contentView.wantsLayer = true
        contentView.layer?.backgroundColor = NSColor(calibratedWhite: 0.985, alpha: 1.0).cgColor

        if let icon = NSImage(contentsOf: appRoot.appendingPathComponent("assets/app_icon_rounded.png")) {
            iconView.image = icon
        }
        iconView.imageScaling = .scaleProportionallyUpOrDown
        iconView.wantsLayer = true
        iconView.layer?.cornerRadius = 18
        iconView.layer?.masksToBounds = true
        iconView.translatesAutoresizingMaskIntoConstraints = false

        let titleLabel = NSTextField(labelWithString: "BXB Client 正在启动")
        titleLabel.font = .systemFont(ofSize: 28, weight: .bold)
        titleLabel.alignment = .center

        if let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String {
            subtitleLabel.stringValue = "macOS Release \(version)"
        } else {
            subtitleLabel.stringValue = "macOS Release"
        }
        subtitleLabel.font = .systemFont(ofSize: 12, weight: .medium)
        subtitleLabel.textColor = NSColor.secondaryLabelColor
        subtitleLabel.alignment = .center

        statusLabel.font = .systemFont(ofSize: 14, weight: .medium)
        statusLabel.alignment = .center
        statusLabel.lineBreakMode = .byWordWrapping
        statusLabel.maximumNumberOfLines = 2

        spinner.style = .spinning
        spinner.controlSize = .regular
        spinner.startAnimation(nil)

        let scrollView = NSScrollView()
        scrollView.borderType = .bezelBorder
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = true
        scrollView.wantsLayer = true
        scrollView.layer?.cornerRadius = 12
        scrollView.layer?.borderWidth = 1
        scrollView.layer?.borderColor = NSColor.separatorColor.cgColor

        detailView.isEditable = false
        detailView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        detailView.backgroundColor = NSColor.textBackgroundColor
        detailView.string = "准备中...\n"
        detailView.textColor = NSColor.labelColor
        scrollView.documentView = detailView

        closeButton.target = self
        closeButton.action = #selector(closeWindow)
        closeButton.isHidden = true
        closeButton.bezelStyle = .rounded

        openLogButton.target = self
        openLogButton.action = #selector(openLog)
        openLogButton.isHidden = true
        openLogButton.bezelStyle = .rounded

        let headerStack = NSStackView(views: [spinner, statusLabel])
        headerStack.orientation = .horizontal
        headerStack.alignment = .centerY
        headerStack.spacing = 10

        let buttonStack = NSStackView(views: [openLogButton, closeButton])
        buttonStack.orientation = .horizontal
        buttonStack.alignment = .centerY
        buttonStack.spacing = 10
        buttonStack.edgeInsets = NSEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
        buttonStack.setHuggingPriority(.required, for: .vertical)

        let heroStack = NSStackView(views: [iconView, titleLabel, subtitleLabel, headerStack])
        heroStack.orientation = .vertical
        heroStack.alignment = .centerX
        heroStack.spacing = 10

        let stack = NSStackView(views: [heroStack, scrollView, buttonStack])
        stack.orientation = .vertical
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false

        contentView.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -20),
            scrollView.heightAnchor.constraint(equalToConstant: 240),
            iconView.widthAnchor.constraint(equalToConstant: 72),
            iconView.heightAnchor.constraint(equalToConstant: 72),
            spinner.widthAnchor.constraint(equalToConstant: 20)
        ])
    }

    func start() {
        updateStatus("正在检测环境...")
        appendLine("启动器已打开")

        let scriptURL = appRoot.appendingPathComponent("macos_bootstrap_headless.sh")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [scriptURL.path]
        process.currentDirectoryURL = appRoot

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.consume(text: text)
            }
        }

        process.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                pipe.fileHandleForReading.readabilityHandler = nil
                self?.handleTermination(code: proc.terminationStatus)
            }
        }

        do {
            try process.run()
            self.process = process
        } catch {
            appendLine("无法启动安装脚本：\(error.localizedDescription)")
            handleTermination(code: 1)
        }
    }

    private func consume(text: String) {
        let parts = text.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false)
        for rawPart in parts {
            let line = String(rawPart)
            if line.isEmpty { continue }
            appendLine(line)
            if !line.hasPrefix("Python ") && !line.hasPrefix("Requirement already satisfied") {
                updateStatus(line)
            }
        }
    }

    private func appendLine(_ line: String) {
        logLines.append(line)
        if logLines.count > 200 {
            logLines.removeFirst(logLines.count - 200)
        }
        detailView.string = logLines.joined(separator: "\n")
        detailView.scrollToEndOfDocument(nil)
    }

    private func updateStatus(_ text: String) {
        statusLabel.stringValue = text
    }

    private func handleTermination(code: Int32) {
        spinner.stopAnimation(nil)
        if code == 0 {
            statusLabel.textColor = NSColor.systemGreen
            updateStatus("启动成功，正在打开软件...")
            appendLine("启动成功，窗口即将自动关闭。")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                NSApp.terminate(nil)
            }
        } else {
            statusLabel.textColor = NSColor.systemRed
            updateStatus("启动失败，请查看下方日志。")
            appendLine("启动失败，日志文件：\(logFile.path)")
            closeButton.isHidden = false
            openLogButton.isHidden = false
        }
    }

    @objc private func closeWindow() {
        NSApp.terminate(nil)
    }

    @objc private func openLog() {
        NSWorkspace.shared.open(logFile)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controller: LauncherWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let bundleURL = Bundle.main.bundleURL
        let appRoot = bundleURL.appendingPathComponent("Contents/Resources/app", isDirectory: true)
        let controller = LauncherWindowController(appRoot: appRoot)
        self.controller = controller
        controller.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        controller.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
