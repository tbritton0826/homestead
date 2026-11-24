import Foundation
import Observation
import Network

@MainActor @Observable
final class ConnectionMonitor {
    private(set) var revision = 0
    private(set) var available = false
    private let monitor = NWPathMonitor()
    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let connected = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self else { return }
                // Even two Wi-Fi paths may represent different networks/routes.
                self.available = connected; self.revision += 1
            }
        }
        monitor.start(queue: DispatchQueue(label: "Homestead.network"))
    }
    deinit { monitor.cancel() }
}
