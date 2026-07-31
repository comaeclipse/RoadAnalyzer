import Foundation

enum UploadError: Error {
    case missingEndpoint
    /// 4xx other than 408/429: the payload itself is unacceptable, so resending
    /// it unchanged can never succeed. Retrying these forever blocks the queue.
    case rejected(status: Int)
    /// Transport failure or 5xx: worth retrying with backoff.
    case transient
}

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
        guard let http = response as? HTTPURLResponse else { throw UploadError.transient }
        if (200..<300).contains(http.statusCode) { return }
        // 408 and 429 are 4xx but explicitly worth retrying later.
        if (400..<500).contains(http.statusCode), http.statusCode != 408, http.statusCode != 429 {
            throw UploadError.rejected(status: http.statusCode)
        }
        throw UploadError.transient
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
