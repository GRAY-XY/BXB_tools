import Foundation

struct BackendAppInfo: Decodable, Sendable {
    let version: String
    let nodeVersion: String?
    let platform: String
    let isPackaged: Bool
}

struct BackendSessionStatus: Decodable, Sendable {
    struct User: Decodable, Sendable {
        let id: String?
        let name: String?
        let loginName: String?
    }

    struct CurrentClass: Decodable, Sendable {
        let id: String?
        let name: String?
        let campusId: String?
    }

    struct Subject: Decodable, Sendable {
        let id: String?
        let classId: String?
        let name: String?
        let allSubjects: Bool?
        let unSubmitCount: Int?
    }

    struct Term: Decodable, Sendable {
        let id: String?
        let name: String?
        let status: Bool?
    }

    let ready: Bool
    let capturedAt: String?
    let loginSource: String?
    let user: User?
    let currentClass: CurrentClass?
    let currentTermId: String?
    let currentTermName: String?
    let currentSubject: Subject?
    let availableTerms: [Term]?
    let availableSubjects: [Subject]?

    var courseCount: Int {
        availableSubjects?.count ?? 0
    }

    var pendingCount: Int {
        availableSubjects?.compactMap(\.unSubmitCount).reduce(0, +) ?? 0
    }
}
