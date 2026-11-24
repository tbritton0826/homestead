import SwiftUI

struct NativeCalendarEditor: View {
    let event: FamilyCalendarEvent?
    let client: HomesteadClient
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var person: String
    @State private var kind: String
    @State private var date: Date
    @State private var start: Date
    @State private var end: Date
    @State private var location: String
    @State private var driver: String
    @State private var visibility: String
    @State private var selectedUsers: Set<String>
    @State private var audience: [IndexValue] = []
    @State private var canEdit = false
    @State private var busy = false
    @State private var error: String?
    @State private var scope = "only"
    @State private var repeats = false
    @State private var repeatPreset = "weekdays"
    @State private var repeatDays = Set([1, 2, 3, 4, 5])
    @State private var seriesEnd = Calendar.current.date(byAdding: .day, value: 30, to: Date()) ?? Date()
    @State private var rotation = Array(repeating: [Int: Int](), count: 2)
    @State private var rotationCount = 2
    init(event: FamilyCalendarEvent?, client: HomesteadClient, onSaved: @escaping () -> Void) {
        self.event = event; self.client = client; self.onSaved = onSaved
        let row = event?.row
        _title = State(initialValue: event?.title ?? "")
        _person = State(initialValue: row?["personName"]?.text ?? "")
        _kind = State(initialValue: event?.kind ?? "appointment")
        let formatter = FamilyCalendarDate.formatter("yyyy-MM-dd")
        let date = formatter.date(from: event?.date ?? "") ?? Date()
        _date = State(initialValue: date)
        formatter.dateFormat = "HH:mm"
        _start = State(initialValue: formatter.date(from: row?["startTime"]?.text ?? "09:00") ?? date)
        _end = State(initialValue: formatter.date(from: row?["endTime"]?.text ?? "10:00") ?? date)
        _location = State(initialValue: row?["location"]?.text ?? "")
        _driver = State(initialValue: row?["assignedDriver"]?.text ?? "")
        _visibility = State(initialValue: row?["visibility"]?.text ?? "all")
        _selectedUsers = State(initialValue: Set(row?["visibleToUserIds"]?.list.compactMap(\.text) ?? []))
    }
    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).foregroundStyle(.orange) }
                if !canEdit { Text(event?.imported == true ? "This event is managed by its calendar source." : "Checking editing access, or this event is read-only.").font(.footnote) }
                Section("Event") {
                    TextField("Event name", text: $title)
                    TextField("Person (optional)", text: $person)
                    Picker("Type", selection: $kind) {
                        ForEach(["appointment", "work", "school", "pickup", "dropoff", "ride", "family", "reminder", "off"], id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    if kind != "off" {
                        DatePicker("Starts", selection: $start, displayedComponents: .hourAndMinute)
                        DatePicker("Ends", selection: $end, displayedComponents: .hourAndMinute)
                    }
                    TextField("Location", text: $location)
                    if ["pickup", "dropoff", "ride"].contains(kind) { TextField("Assigned driver", text: $driver) }
                }.disabled(!canEdit || busy)
                if event == nil {
                    Section("Repeats") {
                        Toggle("Repeats", isOn: $repeats)
                        if repeats {
                            Picker("Pattern", selection: $repeatPreset) {
                                Text("Every day").tag("daily"); Text("Weekdays").tag("weekdays"); Text("Weekends").tag("weekends")
                                Text("Choose days").tag("custom"); Text("Multiweek rotation").tag("rotation")
                            }
                            DatePicker("Ends on", selection: $seriesEnd, in: date..., displayedComponents: .date)
                            if repeatPreset == "custom" {
                                ForEach(0..<7, id: \.self) { day in Toggle(Calendar.current.weekdaySymbols[day], isOn: Binding(
                                    get: { repeatDays.contains(day) }, set: { if $0 { repeatDays.insert(day) } else { repeatDays.remove(day) } })) }
                            }
                            if repeatPreset == "rotation" {
                                Picker("Weeks in rotation", selection: $rotationCount) { ForEach(1...12, id: \.self) { Text(String($0)).tag($0) } }
                                ForEach(rotation.indices, id: \.self) { week in
                                    Text("Week \(week + 1)").font(.headline)
                                    ForEach(0..<7, id: \.self) { day in
                                        Picker(Calendar.current.weekdaySymbols[day], selection: Binding(
                                            get: { rotation[week][day] ?? 0 }, set: { rotation[week][day] = $0 })) {
                                            Text("Unscheduled").tag(0); Text("Work").tag(1); Text("Off").tag(2)
                                        }
                                    }
                                }
                            }
                        }
                    }.disabled(!canEdit || busy)
                }
                Section("Who can see this event?") {
                    Picker("Visibility", selection: $visibility) {
                        Text("Only me").tag("self"); Text("My household").tag("household")
                        Text("Selected people").tag("selected"); Text("Everyone with Calendar access").tag("all")
                    }
                    if visibility == "selected" {
                        ForEach(Array(audience.enumerated()), id: \.offset) { _, user in
                            if let id = user["id"]?.text {
                                Toggle(user["displayName"]?.text ?? "Account", isOn: Binding(
                                    get: { selectedUsers.contains(id) },
                                    set: { if $0 { selectedUsers.insert(id) } else { selectedUsers.remove(id) } }))
                            }
                        }
                    }
                }.disabled(!canEdit || busy)
                if event?.row["seriesId"]?.text != nil || event?.row["importId"]?.text != nil {
                    Picker("Apply changes to", selection: $scope) { Text("This event only").tag("only"); Text("All in this group").tag("series") }
                        .disabled(!canEdit || busy)
                }
            }
            .navigationTitle(event == nil ? "Add event" : "Event details").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .topBarTrailing) { Button(busy ? "Saving…" : "Save") { Task { await save() } }.disabled(!canEdit || busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            }
            .task {
                do {
                    let session: IndexValue = try await client.request("api/auth/session")
                    let response: IndexValue = try await client.request("api/calendar/audience")
                    audience = response["users"]?.list ?? []
                    let user = session["user"]
                    let creator = event?.row["ownerUserId"]?.text ?? ""
                    canEdit = session["ok"]?.flag == true && event?.imported != true &&
                        event?.row["readOnly"]?.flag != true && event?.row["sourceId"] == nil && user?["readOnly"]?.flag != true &&
                        (event == nil || creator.isEmpty || creator == user?["id"]?.text)
                } catch { self.error = error.localizedDescription }
            }
            .onChange(of: rotationCount) { _, count in rotation = Array((rotation + Array(repeating: [Int: Int](), count: 12)).prefix(count)) }
            .onChange(of: date) { _, value in if seriesEnd < value { seriesEnd = Calendar.current.date(byAdding: .day, value: 30, to: value) ?? value } }
        }.interactiveDismissDisabled(busy)
    }
    private func save() async {
        guard canEdit, !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        let formatter = FamilyCalendarDate.formatter("yyyy-MM-dd")
        var fields = event?.row.fields ?? [:]
        fields["title"] = .string(title); fields["personName"] = .string(person); fields["kind"] = .string(kind)
        fields["date"] = .string(formatter.string(from: date)); formatter.dateFormat = "HH:mm"
        fields["startTime"] = .string(formatter.string(from: start)); fields["endTime"] = .string(formatter.string(from: end))
        fields["location"] = .string(location); fields["assignedDriver"] = .string(driver)
        fields["visibility"] = .string(visibility); fields["visibleToUserIds"] = .array(selectedUsers.sorted().map(IndexValue.string))
        fields["allDay"] = .bool(kind == "off"); fields["scope"] = .string(scope); fields["repeats"] = .bool(false)
        if event == nil && repeats {
            let days = repeatPreset == "daily" ? Array(0..<7) : repeatPreset == "weekdays" ? [1,2,3,4,5] : repeatPreset == "weekends" ? [0,6] : repeatDays.sorted()
            if repeatPreset != "rotation" && days.isEmpty { error = "Choose at least one day."; return }
            if repeatPreset == "rotation" && !rotation.contains(where: { $0.values.contains(1) || $0.values.contains(2) }) { error = "Choose working or off days in the rotation."; return }
            formatter.dateFormat = "yyyy-MM-dd"
            fields["repeats"] = .bool(true)
            fields["recurrence"] = .object([
                "frequency": .string(repeatPreset == "rotation" ? "rotating" : "weekly"), "preset": .string(repeatPreset),
                "startsOn": fields["date"] ?? .string(""), "endsOn": .string(formatter.string(from: seriesEnd)),
                "daysOfWeek": .array(days.map { .number(Double($0)) }),
                "rotationWeeks": .array(rotation.map { week in .object([
                    "workDays": .array(week.keys.filter { week[$0] == 1 }.sorted().map { .number(Double($0)) }),
                    "offDays": .array(week.keys.filter { week[$0] == 2 }.sorted().map { .number(Double($0)) })]) }),
                "exceptions": .array([])])
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: IndexValue.object(fields).jsonObject)
            let path = event.map { "api/calendar/events/" + $0.id } ?? "api/calendar/events"
            let response: IndexValue = try await client.request(path, method: event == nil ? "POST" : "PATCH", body: data)
            guard response["ok"]?.flag == true else { throw CompanionError.message(response["message"]?.text ?? "Unable to save event.") }
            onSaved(); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
