import Foundation

actor ImageRequestPool {
    private struct Entry {
        let token: UUID
        let task: Task<Data, Error>
        var waiters: Set<UUID>
    }
    private struct Waiting {
        let id: UUID
        let continuation: CheckedContinuation<Void, Error>
    }
    private let maximumConcurrent: Int
    private let maximumBytes: Int
    private var active = 0
    private var queue: [Waiting] = []
    private var pending: [String: Entry] = [:]
    private var cache: [String: Data] = [:]
    private var recency: [String] = []
    private var bytes = 0
    private var generation = UUID()

    init(maximumConcurrent: Int = 4, maximumBytes: Int = 48 * 1024 * 1024) {
        self.maximumConcurrent = max(1, maximumConcurrent)
        self.maximumBytes = max(0, maximumBytes)
    }
    func load(_ key: String, operation: @escaping @Sendable () async throws -> Data) async throws -> Data {
        try Task.checkCancellation()
        if let data = cache[key] { touch(key); return data }
        let waiter = UUID()
        let token: UUID
        if var entry = pending[key] {
            token = entry.token; entry.waiters.insert(waiter); pending[key] = entry
        } else {
            token = UUID()
            let task: Task<Data, Error> = Task {
                try await self.acquire()
                defer { self.release() }
                try Task.checkCancellation()
                return try await operation()
            }
            pending[key] = Entry(token: token, task: task, waiters: [waiter])
        }
        guard let task = pending[key]?.task else { throw CancellationError() }
        let stamp = generation
        defer { leave(key, token: token, waiter: waiter) }
        let data = try await withTaskCancellationHandler(operation: {
            try await task.value
        }, onCancel: { Task { await self.leave(key, token: token, waiter: waiter) } })
        try Task.checkCancellation()
        guard stamp == generation else { throw CancellationError() }
        if pending[key]?.token == token { insert(data, key: key) }
        return data
    }
    func clear() {
        generation = UUID()
        for entry in pending.values { entry.task.cancel() }
        pending = [:]; cache = [:]; recency = []; bytes = 0
    }
    private func leave(_ key: String, token: UUID, waiter: UUID) {
        guard var entry = pending[key], entry.token == token else { return }
        entry.waiters.remove(waiter)
        if entry.waiters.isEmpty { pending[key] = nil; entry.task.cancel() }
        else { pending[key] = entry }
    }
    private func acquire() async throws {
        try Task.checkCancellation()
        if active < maximumConcurrent { active += 1; return }
        let id = UUID()
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                if Task.isCancelled { continuation.resume(throwing: CancellationError()) }
                else { queue.append(Waiting(id: id, continuation: continuation)) }
            }
        }, onCancel: { Task { await self.cancelWaiting(id) } })
    }
    private func cancelWaiting(_ id: UUID) {
        guard let index = queue.firstIndex(where: { $0.id == id }) else { return }
        queue.remove(at: index).continuation.resume(throwing: CancellationError())
    }
    private func release() {
        if !queue.isEmpty { queue.removeFirst().continuation.resume() }
        else { active -= 1 }
    }
    private func touch(_ key: String) { recency.removeAll { $0 == key }; recency.append(key) }
    private func insert(_ data: Data, key: String) {
        guard data.count <= maximumBytes else { return }
        bytes -= cache[key]?.count ?? 0
        cache[key] = data; bytes += data.count; touch(key)
        while (bytes > maximumBytes || recency.count > 96), let oldest = recency.first {
            recency.removeFirst(); bytes -= cache.removeValue(forKey: oldest)?.count ?? 0
        }
    }
}
