import Foundation

public enum BackendURLConfiguration {
    private static let productionHost = "ai-shortcut-plan-api.onrender.com"

    public static func resolve(buildValue: String?, debugOverride: String?, isDebug: Bool) -> URL? {
        let selectedValue = isDebug && !(debugOverride ?? "").isEmpty ? debugOverride : buildValue
        guard let raw = selectedValue,
              let components = URLComponents(string: raw),
              let url = components.url,
              let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(),
              components.user == nil,
              components.password == nil,
              components.fragment == nil else { return nil }

        if isDebug {
            return scheme == "http" || scheme == "https" ? url : nil
        }

        guard scheme == "https",
              host == productionHost,
              components.path == "/plan",
              components.port == nil || components.port == 443,
              components.query == nil else { return nil }
        return url
    }
}
