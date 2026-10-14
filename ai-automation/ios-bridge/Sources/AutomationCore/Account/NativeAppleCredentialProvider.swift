#if os(iOS)
import AuthenticationServices
import Foundation
import UIKit

/// Apple credential presentation stays on the main actor. The nonce is the
/// exact server-issued value; no client-side protocol hash is added.
public struct NativeAppleCredentialProvider: AppleCredentialProvider {
    public init() {}

    public func request(nonce: String) async -> AppleCredentialOutcome {
        let bridge = await MainActor.run { NativeAppleRequestBridge() }
        return await bridge.perform(nonce: nonce)
    }

    public func state(for appleUserID: String) async -> AccountCredentialState {
        await withCheckedContinuation { continuation in
            ASAuthorizationAppleIDProvider().getCredentialState(forUserID: appleUserID) { state, error in
                if error != nil { continuation.resume(returning: .unknown); return }
                switch state {
                case .authorized: continuation.resume(returning: .authorized)
                case .revoked, .notFound: continuation.resume(returning: .revoked)
                case .transferred: continuation.resume(returning: .transferred)
                @unknown default: continuation.resume(returning: .unknown)
                }
            }
        }
    }
}

@MainActor
private final class NativeAppleRequestBridge: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<AppleCredentialOutcome, Never>?
    private var controller: ASAuthorizationController?
    private var expectedState: String?

    func perform(nonce: String) async -> AppleCredentialOutcome {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.nonce = nonce
            let state = UUID().uuidString
            expectedState = state
            request.state = state
            // The backend uses Apple sub; email and full name are not required.
            request.requestedScopes = []
            let controller = ASAuthorizationController(authorizationRequests: [request])
            self.controller = controller
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              credential.state == expectedState,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8),
              !credential.user.isEmpty else {
            finish(.failed)
            return
        }
        finish(.credential(AppleIdentityCredential(appleUserID: credential.user, identityToken: token)))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let code = (error as NSError).code
        let domain = (error as NSError).domain
        finish(domain == ASAuthorizationError.errorDomain && code == ASAuthorizationError.canceled.rawValue ? .cancelled : .failed)
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
        return windows.first(where: \.isKeyWindow) ?? windows.first ?? UIWindow()
    }

    private func finish(_ outcome: AppleCredentialOutcome) {
        let pending = continuation
        continuation = nil
        controller = nil
        expectedState = nil
        pending?.resume(returning: outcome)
    }
}
#endif
