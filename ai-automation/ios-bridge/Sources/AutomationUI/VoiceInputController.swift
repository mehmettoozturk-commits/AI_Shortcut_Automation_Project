#if os(iOS)
import AVFoundation
import AutomationCore
import Combine
import Foundation
import Speech

/// Dictation only: recognized text enters the existing planner field and is
/// never submitted without the user's explicit Gönder action.
@MainActor
final class VoiceInputController: ObservableObject {
    @Published private(set) var transcript = ""
    @Published private(set) var isRecording = false
    @Published private(set) var message: String?

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private let gate = VoiceSessionGate()
    private var tapInstalled = false
    private var startAttempt: UUID?
    private let resources = VoiceResourceOwner()

    func start() async {
        guard !isRecording, !gate.isStarting else { return }
        let attempt = UUID()
        startAttempt = attempt
        message = nil
        let authorized = await gate.authorize(permission: { [weak self] in
            guard let self else { return false }
            guard await self.speechPermission(), self.startAttempt == attempt else { return false }
            return await self.microphonePermission()
        })
        guard startAttempt == attempt else { return }
        guard let session = authorized else {
            // A stop during the permission dialog is cancellation, not denial.
            // No audio resources have been installed at this point.
            message = "Ses izni verilmedi. İsteğini yazarak gönderebilirsin."
            return
        }
        // The planner's physical MVP test is Turkish; do not silently fall
        // back to the device's (possibly English) locale.
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "tr-TR")), recognizer.isAvailable else {
            gate.stop()
            message = "Ses tanıma şu an kullanılamıyor. İsteğini yazarak gönderebilirsin."
            return
        }
        self.recognizer = recognizer
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.request = request
        transcript = ""

        do {
            try resources.start(acquire: {
            try AVAudioSession.sharedInstance().setCategory(.record, mode: .measurement, options: .duckOthers)
            try AVAudioSession.sharedInstance().setActive(true, options: .notifyOthersOnDeactivation)
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
                request?.append(buffer)
            }
            tapInstalled = true
            engine.prepare()
            try engine.start()
            isRecording = true
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor [weak self] in
                    guard let self, self.gate.accepts(session) else { return }
                    if let result {
                        self.transcript = result.bestTranscription.formattedString
                        if result.isFinal { self.stop() }
                    }
                    if error != nil {
                        self.message = "Ses tanınamadı. Metni düzenleyip yeniden deneyebilirsin."
                        self.stop()
                    }
                }
            }
            }, release: { [weak self] in
                guard let self else { return }
                self.engine.stop()
                if self.tapInstalled {
                    self.engine.inputNode.removeTap(onBus: 0)
                    self.tapInstalled = false
                }
                self.request?.endAudio()
                self.task?.cancel()
                self.task = nil
                self.request = nil
                self.isRecording = false
                try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            })
        } catch {
            gate.stop()
            message = "Mikrofon başlatılamadı. İsteğini yazarak gönderebilirsin."
        }
    }

    func stop() {
        startAttempt = nil
        gate.stop()
        resources.stop()
    }

    private func speechPermission() async -> Bool {
        if SFSpeechRecognizer.authorizationStatus() == .authorized { return true }
        return await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    private func microphonePermission() async -> Bool {
        if #available(iOS 17.0, *) {
            if AVAudioApplication.shared.recordPermission == .granted { return true }
            return await withCheckedContinuation { continuation in
                AVAudioApplication.requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        } else {
            if AVAudioSession.sharedInstance().recordPermission == .granted { return true }
            return await withCheckedContinuation { continuation in
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        }
    }
}
#endif
