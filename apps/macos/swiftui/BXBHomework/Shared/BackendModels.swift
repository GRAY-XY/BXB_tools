import Foundation

struct BackendAppInfo: Decodable, Sendable {
    struct BrowserDependency: Decodable, Sendable {
        let ready: Bool?
        let browserRoot: String?
    }

    let version: String
    let nodeVersion: String?
    let platform: String
    let isPackaged: Bool
    let workspaceDir: String?
    let userDataRoot: String?
    let dataRoot: String?
    let draftDir: String?
    let updateDir: String?
    let modelConfigPath: String?
    let conversationsPath: String?
    let payloadRoot: String?
    let browserDependency: BrowserDependency?
}

struct BackendSessionStatus: Decodable, Sendable {
    struct User: Decodable, Sendable {
        let id: String?
        let name: String?
        let loginName: String?

        init(from decoder: Decoder) throws {
            let value = try JSONValue(from: decoder)
            id = value["id"].nullableString
            name = value["name"].nullableString
            loginName = value["loginName"].nullableString
        }
    }

    struct CurrentClass: Decodable, Sendable {
        let id: String?
        let name: String?
        let campusId: String?

        init(from decoder: Decoder) throws {
            let value = try JSONValue(from: decoder)
            id = value["id"].nullableString
            name = value["name"].nullableString
            campusId = value["campusId"].nullableString
        }
    }

    struct Subject: Decodable, Sendable {
        let id: String?
        let classId: String?
        let name: String?
        let allSubjects: Bool?
        let unSubmitCount: Int?

        init(from decoder: Decoder) throws {
            let value = try JSONValue(from: decoder)
            id = value["id"].nullableString
            classId = value["classId"].nullableString
            name = value["name"].nullableString
            allSubjects = value["allSubjects"].boolValue
            unSubmitCount = value["unSubmitCount"].intValue
        }
    }

    struct Term: Decodable, Sendable {
        let id: String?
        let name: String?
        let status: Bool?

        init(from decoder: Decoder) throws {
            let value = try JSONValue(from: decoder)
            id = value["id"].nullableString
            name = value["name"].nullableString
            status = value["status"].boolValue
        }
    }

    let ready: Bool
    let capturedAt: String?
    let loginSource: String?
    let user: User?
    let currentClass: CurrentClass?
    let currentTermId: String?
    var currentTermName: String? {
        availableTerms?.first { $0.id == currentTermId }?.name
    }
    let currentSubject: Subject?
    let availableTerms: [Term]?
    let availableSubjects: [Subject]?

    init(from decoder: Decoder) throws {
        let value = try JSONValue(from: decoder)
        guard let ready = value["ready"].boolValue else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Session response is missing ready"))
        }
        self.ready = ready
        capturedAt = value["capturedAt"].nullableString
        loginSource = value["loginSource"].nullableString
        user = value["user"] == .null ? nil : try value["user"].decoded(User.self)
        currentClass = value["currentClass"] == .null ? nil : try value["currentClass"].decoded(CurrentClass.self)
        currentTermId = value["currentTermId"].nullableString
        currentSubject = value["currentSubject"] == .null ? nil : try value["currentSubject"].decoded(Subject.self)
        availableTerms = try value["availableTerms"].arrayValue.map { try $0.decoded(Term.self) }
        availableSubjects = try value["availableSubjects"].arrayValue.map { try $0.decoded(Subject.self) }
    }

    var courseCount: Int {
        availableSubjects?.count ?? 0
    }

    var pendingCount: Int {
        availableSubjects?.compactMap(\.unSubmitCount).reduce(0, +) ?? 0
    }
}

private extension JSONValue {
    var nullableString: String? { stringValue.isEmpty ? nil : stringValue }
}
