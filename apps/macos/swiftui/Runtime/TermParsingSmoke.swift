import Foundation

@main
struct TermParsingSmoke {
    static func main() throws {
        let payload = #"""
        {"ready":true,"user":{"id":7,"name":"Student"},
         "currentClass":{"id":8,"campusId":9},"currentTermId":2,
         "availableTerms":[{"id":1,"name":"Term A","status":true},
                           {"id":2,"name":"Term B","status":"0"}],
         "currentSubject":{"id":12,"classId":8,"name":"Course"},
         "availableSubjects":[{"id":12,"classId":8,"name":"Course"}]}
        """#
        let session = try JSONDecoder().decode(BackendSessionStatus.self, from: Data(payload.utf8))
        precondition(session.currentTermId == "2")
        precondition(session.currentTermName == "Term B", "Use the selected ID, not the default status flag")
        precondition(session.user?.id == "7")
        precondition(session.currentClass?.id == "8")
        precondition(session.availableSubjects?.first?.classId == "8")
        precondition(session.availableTerms?.last?.status == false)
        let loggedOut = try JSONDecoder().decode(BackendSessionStatus.self, from: Data(#"{"ready":false}"#.utf8))
        precondition(loggedOut.currentTermName == nil)
        print("term-parser=ok numeric-ids selected-term logged-out")
    }
}
