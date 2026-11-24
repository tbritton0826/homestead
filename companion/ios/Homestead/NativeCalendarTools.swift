import SwiftUI
import UniformTypeIdentifiers
import PhotosUI

struct NativeCalendarTools: View {
    let client: HomesteadClient
    @Binding var hiddenSources: Set<String>
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var tab = "Sources"
    var body: some View {
        NavigationStack {
            VStack {
                Picker("Calendar options", selection: $tab) { Text("Sources").tag("Sources"); Text("Import schedule").tag("Import") }.pickerStyle(.segmented).padding()
                if tab == "Sources" { NativeCalendarSources(client: client, hidden: $hiddenSources, onSaved: onSaved) }
                else { NativeScheduleImport(client: client, onSaved: onSaved) }
            }.navigationTitle("Calendar options").navigationBarTitleDisplayMode(.inline).toolbar { Button("Close") { dismiss() } }
        }
    }
}

private struct NativeCalendarSources: View {
    let client: HomesteadClient
    @Binding var hidden: Set<String>
    let onSaved: () -> Void
    @State private var catalog: IndexValue = .object([:])
    @State private var admin = false
    @State private var busy = false
    @State private var error: String?
    @State private var type = "ical"
    @State private var url = ""
    @State private var name = ""
    @State private var team = ""
    @State private var service = ""
    @State private var removal: String?
    @State private var confirmRemoval = false
    var body: some View {
        Form {
            if let error { Text(error).foregroundStyle(.orange) }
            Section("Subscribed schedules") {
                ForEach(Array((catalog["sources"]?.list ?? []).enumerated()), id: \.offset) { _, source in
                    if let id = source["id"]?.text {
                        VStack(alignment: .leading, spacing: 8) {
                            Toggle(source["name"]?.text ?? "Calendar source", isOn: Binding(
                                get: { !hidden.contains(id) }, set: { if $0 { hidden.remove(id) } else { hidden.insert(id) } }))
                            if let message = source["lastError"]?.text, !message.isEmpty { Text(message).font(.caption).foregroundStyle(.orange) }
                            if admin {
                                HStack {
                                    Button("Refresh") { Task { await mutate("/" + id + "/refresh", method: "POST") } }
                                    Button("Unsubscribe", role: .destructive) { removal = id; confirmRemoval = true }
                                }.disabled(busy)
                            }
                        }
                    }
                }
            }
            if admin {
                Section("Add a source") {
                    Picker("Source type", selection: $type) { Text("Online calendar").tag("ical"); Text("NFL").tag("nfl"); Text("Media releases").tag("arr") }
                    TextField("Name (optional)", text: $name)
                    if type == "ical" { TextField("Calendar feed URL", text: $url).textInputAutocapitalization(.never).autocorrectionDisabled() }
                    if type == "nfl" {
                        Picker("Team", selection: $team) { ForEach((catalog["nflTeams"]?.fields ?? [:]).keys.sorted(), id: \.self) { key in Text(catalog["nflTeams"]?[key]?.text ?? key).tag(key) } }
                    }
                    if type == "arr" {
                        Picker("Media service", selection: $service) {
                            ForEach(Array((catalog["availableArr"]?.list ?? []).filter { $0["configured"]?.flag == true }.enumerated()), id: \.offset) { _, item in
                                Text(item["service"]?.text ?? "").tag(item["service"]?.text ?? "")
                            }
                        }
                    }
                    Button("Subscribe") { Task { await subscribe() } }.disabled(busy || (type == "ical" && url.isEmpty) || (type == "nfl" && team.isEmpty) || (type == "arr" && service.isEmpty))
                }
            }
        }.task { await load() }
            .confirmationDialog("Unsubscribe and remove this source's events?", isPresented: $confirmRemoval, titleVisibility: .visible) {
                Button("Unsubscribe", role: .destructive) { if let removal { Task { await mutate("/" + removal, method: "DELETE") } } }
                Button("Cancel", role: .cancel) {}
            }
        .homesteadLoading(busy, message: "Loading calendar sources…")
    }
    private func load() async {
        do {
            let session: IndexValue = try await client.request("api/auth/session")
            admin = session["user"]?["role"]?.text == "owner" || session["authEnabled"]?.flag == false
            catalog = try await client.request("api/calendar/sources")
            if team.isEmpty { team = catalog["nflTeams"]?.fields.keys.sorted().first ?? "" }
            if service.isEmpty { service = catalog["availableArr"]?.list.first(where: { $0["configured"]?.flag == true })?["service"]?.text ?? "" }
        } catch { self.error = error.localizedDescription }
    }
    private func mutate(_ suffix: String, method: String, body: Data? = nil) async {
        guard admin, !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let response: IndexValue = try await client.request("api/calendar/sources" + suffix, method: method, body: body, timeout: 45)
            guard response["ok"]?.flag == true else { throw CompanionError.message(response["message"]?.text ?? "Source update failed.") }
            error = response["warning"]?.text
            await load(); onSaved()
        } catch { self.error = error.localizedDescription }
    }
    private func subscribe() async {
        do {
            let body = try JSONSerialization.data(withJSONObject: ["type": type, "name": name, "url": url, "team": team, "service": service])
            await mutate("", method: "POST", body: body)
        } catch { self.error = error.localizedDescription }
    }
}

private struct NativeScheduleImport: View {
    let client: HomesteadClient
    let onSaved: () -> Void
    @State private var person = ""
    @State private var weekStart = Date()
    @State private var dataURL = ""
    @State private var fileName = ""
    @State private var preview: IndexValue = .object([:])
    @State private var shifts: [IndexValue] = []
    @State private var printedHours = ""
    @State private var visibility = "self"
    @State private var reviewed = false
    @State private var showFile = false
    @State private var photo: PhotosPickerItem?
    @State private var busy = false
    @State private var error: String?
    private var valid: Bool { reviewed && !person.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && CalendarScheduleReview.valid(shifts, printedHours: printedHours.isEmpty ? nil : Double(printedHours)) && (printedHours.isEmpty || Double(printedHours) != nil) }
    var body: some View {
        Form {
            if let error { Text(error).foregroundStyle(.orange) }
            Section("Schedule") {
                TextField("Person / calendar label", text: $person)
                DatePicker("First date", selection: $weekStart, displayedComponents: .date)
                Button(fileName.isEmpty ? "Choose photo or PDF" : fileName) { showFile = true }.disabled(busy)
                PhotosPicker(selection: $photo, matching: .images) { Label("Choose from Photos", systemImage: "photo") }.disabled(busy)
                Button("Preview schedule") { Task { await recognize() } }.disabled(busy || dataURL.isEmpty)
            }
            if !shifts.isEmpty {
                Section("Review every shift") {
                    if let message = preview["message"]?.text { Text(message).font(.footnote) }
                    ForEach((preview["recognition"]?["warnings"]?.list ?? []).compactMap(\.text), id: \.self) { Text($0).font(.footnote).foregroundStyle(.orange) }
                    TextField("Printed hours (if shown)", text: $printedHours).keyboardType(.decimalPad)
                    Text("Calculated hours: " + String(CalendarScheduleReview.hours(shifts) ?? 0)).font(.footnote)
                    ForEach(shifts.indices, id: \.self) { index in
                        VStack(alignment: .leading) {
                            TextField("YYYY-MM-DD", text: binding(index, "date")).textInputAutocapitalization(.never)
                            Picker("Shift", selection: binding(index, "dayType")) { Text("Work").tag("work"); Text("Off").tag("off") }
                            if shifts[index]["dayType"]?.text != "off" {
                                HStack { TextField("Starts HH:mm", text: binding(index, "startTime")); TextField("Ends HH:mm", text: binding(index, "endTime")) }
                                TextField("Location", text: binding(index, "location"))
                            }
                        }
                    }
                    Picker("Visibility", selection: $visibility) { Text("Only me").tag("self"); Text("My household").tag("household"); Text("Everyone with Calendar access").tag("all") }
                    Toggle("I checked every date, time, and the hours total", isOn: $reviewed)
                    Button(busy ? "Importing…" : "Import reviewed schedule") { Task { await save() } }.disabled(!valid || busy)
                }
            }
        }.disabled(busy)
        .task(id: photo) {
            guard let photo else { return }
            busy = true; error = nil
            defer { busy = false }
            do {
                guard let data = try await photo.loadTransferable(type: Data.self), !Task.isCancelled,
                      let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.9), jpeg.count <= 15 * 1024 * 1024 else {
                    throw CompanionError.message("Unable to load a schedule photo within the upload size limit.")
                }
                dataURL = "data:image/jpeg;base64," + jpeg.base64EncodedString()
                fileName = "Schedule photo.jpg"; shifts = []; reviewed = false
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
        .fileImporter(isPresented: $showFile, allowedContentTypes: [.jpeg, .png, .pdf]) { result in
            do {
                let url = try result.get()
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 15 * 1024 * 1024 else { throw CompanionError.message("Schedule files must be 15 MB or smaller.") }
                let data = try Data(contentsOf: url)
                guard data.count <= 15 * 1024 * 1024 else { throw CompanionError.message("Schedule exceeds the upload limit.") }
                let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/pdf"
                dataURL = "data:" + mime + ";base64," + data.base64EncodedString()
                fileName = url.lastPathComponent; shifts = []; reviewed = false
            } catch { self.error = error.localizedDescription }
        }
    }
    private func binding(_ index: Int, _ key: String) -> Binding<String> {
        Binding(get: { shifts[index][key]?.text ?? (key == "dayType" ? "work" : "") },
                set: { var fields = shifts[index].fields; fields[key] = .string($0); shifts[index] = .object(fields); reviewed = false })
    }
    private func recognize() async {
        guard !busy else { return }
        busy = true; error = nil; reviewed = false
        defer { busy = false }
        do {
            let formatter = FamilyCalendarDate.formatter("yyyy-MM-dd")
            let body = try JSONSerialization.data(withJSONObject: ["dataUrl": dataURL, "personName": person, "weekStart": formatter.string(from: weekStart)])
            preview = try await client.request("api/calendar/schedule-preview", method: "POST", body: body, timeout: 120)
            guard preview["ok"]?.flag == true else { throw CompanionError.message(preview["message"]?.text ?? "Unable to recognize schedule.") }
            shifts = preview["shifts"]?.list ?? []
            if person.isEmpty { person = preview["matchedPersonName"]?.text ?? preview["personName"]?.text ?? "" }
            printedHours = preview["recognition"]?["printedHours"]?.text ?? ""
        } catch { self.error = error.localizedDescription }
    }
    private func save() async {
        guard valid, !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            var fields: [String: Any] = ["personName": person, "shifts": shifts.map(\.jsonObject), "dataUrl": dataURL, "fileName": fileName, "visibility": visibility]
            if let hours = Double(printedHours) { fields["printedHours"] = hours }
            let body = try JSONSerialization.data(withJSONObject: fields)
            let response: IndexValue = try await client.request("api/calendar/schedule-import", method: "POST", body: body, timeout: 60)
            guard response["ok"]?.flag == true else { throw CompanionError.message(response["message"]?.text ?? "Schedule was not imported.") }
            shifts = []; dataURL = ""; fileName = ""; reviewed = false; onSaved()
        } catch { self.error = error.localizedDescription }
    }
}
