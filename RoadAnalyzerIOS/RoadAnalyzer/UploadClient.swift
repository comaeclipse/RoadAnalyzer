import Foundation

enum UploadError: Error { case missingEndpoint, invalidResponse }

actor UploadClient {
    static let shared = UploadClient()

    func upload(_ report: MobileReport) async throws {
        guard let base = Bundle.main.object(forInfoDictionaryKey: "RoadAnalyzerAPIBaseURL") as? String,
              let url = URL(string: base)?.appending(path: "api/mobile-reports"),
              !base.contains("YOUR-DEPLOYMENT") else { throw UploadError.missingEndpoint }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 60
        request.httpBody = try JSONEncoder.roadAnalyzer.encode(report)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw UploadError.invalidResponse }
    }
}

extension JSONEncoder {
    static let roadAnalyzer: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()
}
