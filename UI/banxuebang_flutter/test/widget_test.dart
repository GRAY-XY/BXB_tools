import 'package:banxuebang_flutter/src/models/models.dart';
import 'package:banxuebang_flutter/src/screens/notices_page.dart';
import 'package:banxuebang_flutter/src/screens/schedule_page.dart';
import 'package:banxuebang_flutter/src/state/app_controller.dart';
import 'package:banxuebang_flutter/src/theme/app_theme.dart';
import 'package:banxuebang_flutter/src/utils/formatters.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  HomeworkTask buildTask({
    required String id,
    required String scoreLevel,
    required String endTime,
    int isParticipate = 0,
    bool isEnd = false,
  }) {
    return HomeworkTask(
      id: id,
      courseId: 'course-1',
      courseName: '数学',
      activityName: '作业 $id',
      endTime: endTime,
      releaseTime: '2026-05-18 08:00',
      scoreLevel: scoreLevel,
      scoreTypeName: '等级',
      scoreTypeColor: '#548DFF',
      academicScore: 100,
      createName: '老师',
      classId: 'class-1',
      isParticipate: isParticipate,
      isEnd: isEnd,
      raw: const <String, dynamic>{},
    );
  }

  SubjectSummary buildSubject({
    String id = 'course-1',
    String classId = 'class-1',
    String name = '数学',
    int unSubmitCount = 1,
    String color = '#548DFF',
  }) {
    return SubjectSummary(
      id: id,
      classId: classId,
      name: name,
      unSubmitCount: unSubmitCount,
      color: color,
    );
  }

  CourseSummary buildCourse({
    String id = 'course-1',
    String classId = 'class-1',
    String name = '数学',
    int unSubmitCount = 1,
    String color = '#548DFF',
  }) {
    return CourseSummary(
      id: id,
      classId: classId,
      name: name,
      unSubmitCount: unSubmitCount,
      color: color,
      teacherList: const <JsonMap>[
        <String, dynamic>{'userName': '张老师'},
      ],
    );
  }

  NoticeSummary buildNotice({
    required String id,
    required bool read,
    String title = '通知',
  }) {
    return NoticeSummary(
      id: id,
      title: title,
      content: '$title 的正文',
      sender: '系统',
      time: '2026-05-18 09:00',
      read: read,
    );
  }

  DashboardData buildDashboard({
    List<NoticeSummary>? notices,
    Map<int, Map<int, ScheduleSlot>>? schedule,
    Map<int, String>? timeSlots,
    List<CourseSummary>? courses,
    List<SubjectSummary>? subjects,
    List<HomeworkTask>? homework,
    int unreadCount = 0,
  }) {
    final resolvedSubjects = subjects ?? <SubjectSummary>[buildSubject()];
    return DashboardData(
      session: SessionSummary(
        ready: true,
        baseUrl: 'https://example.com',
        sessionFile: '/tmp/session.json',
        currentTermId: 'term-1',
        availableTerms: <TermSummary>[
          TermSummary(id: 'term-1', name: '2025-2026 学年第二学期', status: true),
        ],
        availableSubjects: resolvedSubjects,
        capturedAt: '2026-05-18 10:00',
        loginSource: 'browser',
        user: UserSummary(id: 'user-1', name: '测试同学', loginName: 'test'),
        currentClass: ClassSummary(
          id: 'class-1',
          name: '高一 A 班',
          alias: 'G1A1P1',
          campusId: 'campus-1',
        ),
        currentSubject: resolvedSubjects.first,
      ),
      terms: <TermSummary>[
        TermSummary(id: 'term-1', name: '2025-2026 学年第二学期', status: true),
      ],
      courses: courses ?? <CourseSummary>[buildCourse()],
      homework: homework ?? <HomeworkTask>[],
      pendingHomework: homework ?? <HomeworkTask>[],
      schedule:
          schedule ??
          <int, Map<int, ScheduleSlot>>{
            1: <int, ScheduleSlot>{
              0: ScheduleSlot(
                time: '08:00-08:45',
                courses: <ScheduleCourse>[
                  ScheduleCourse(
                    name: '数学',
                    teacher: '张老师',
                    room: 'A301',
                    color: '#548DFF',
                  ),
                ],
              ),
              1: ScheduleSlot(
                time: '09:00-09:45',
                courses: <ScheduleCourse>[
                  ScheduleCourse(
                    name: '英语',
                    teacher: '李老师',
                    room: 'B204',
                    color: '#34C759',
                  ),
                ],
              ),
            },
            2: <int, ScheduleSlot>{
              0: ScheduleSlot(
                time: '08:00-08:45',
                courses: <ScheduleCourse>[
                  ScheduleCourse(
                    name: '物理',
                    teacher: '王老师',
                    room: 'C102',
                    color: '#FF9500',
                  ),
                ],
              ),
            },
          },
      timeSlots:
          timeSlots ?? const <int, String>{0: '08:00-08:45', 1: '09:00-09:45'},
      notices: notices ?? <NoticeSummary>[],
      unreadCount: UnreadSummary(noticeNotReceipt: unreadCount),
      gpa: GpaSummary(
        averageLevel: 'A',
        achievementCount: 3,
        scoreLevelCount: 5,
        selectedTransferClass: TransferClassSummary(className: 'G1A1P1班'),
      ),
    );
  }

  Future<void> pumpWithController(
    WidgetTester tester,
    AppController controller,
    WidgetBuilder builder,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildAppTheme(Brightness.light),
        home: AnimatedBuilder(
          animation: controller,
          builder: (BuildContext context, Widget? _) {
            return Scaffold(body: builder(context));
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  test('parseClassSubmissionStats reads percent and count pairs', () {
    expect(
      parseClassSubmissionStats(const <String, dynamic>{
        'submitRate': 62,
      })?.percent,
      62,
    );
    final fromCounts = parseClassSubmissionStats(const <String, dynamic>{
      'submitNum': 18,
      'studentNum': 30,
    });
    expect(fromCounts?.submittedCount, 18);
    expect(fromCounts?.totalCount, 30);
    expect(fromCounts?.percent, 60);
    expect(
      formatClassSubmitPercentLabel(
        const ClassSubmissionStats(percent: 75),
      ),
      '约 75% 同学已提交',
    );
  });

  test('isActionableTask only counts open unsubmitted or E+ homework', () {
    expect(
      isActionableTask(
        buildTask(id: 'open-missing', scoreLevel: '', endTime: '2026-05-20 12:00'),
      ),
      isTrue,
    );
    expect(
      isActionableTask(
        buildTask(
          id: 'e-plus',
          scoreLevel: 'E+',
          endTime: '2026-05-20 12:00',
          isParticipate: 1,
        ),
      ),
      isTrue,
    );
    expect(
      isActionableTask(
        buildTask(
          id: 'ended',
          scoreLevel: '',
          endTime: '2026-05-20 12:00',
          isEnd: true,
        ),
      ),
      isFalse,
    );
    expect(
      isActionableTask(
        buildTask(
          id: 'na',
          scoreLevel: 'N/A',
          endTime: '2026-05-20 12:00',
          isParticipate: 1,
        ),
      ),
      isFalse,
    );
    expect(
      isActionableTask(
        buildTask(
          id: 'e-only',
          scoreLevel: 'E',
          endTime: '2026-05-20 12:00',
          isParticipate: 1,
        ),
      ),
      isFalse,
    );
    expect(
      isActionableTask(
        buildTask(
          id: 'submitted-a',
          scoreLevel: 'A',
          endTime: '2026-05-20 12:00',
          isParticipate: 1,
        ),
      ),
      isFalse,
    );
  });

  test('sortTasks orders lower grades before higher grades', () {
    final sorted = sortTasks(<HomeworkTask>[
      buildTask(id: 'best', scoreLevel: 'A', endTime: '2026-05-20 12:00'),
      buildTask(id: 'risk', scoreLevel: 'E', endTime: '2026-05-19 12:00'),
      buildTask(id: 'mid', scoreLevel: 'C', endTime: '2026-05-18 12:00'),
    ], byLowestGrade: true);

    expect(sorted.map((task) => task.id), <String>['risk', 'mid', 'best']);
  });

  test(
    'AppController markNoticeRead and markAllNoticesRead update unread state',
    () {
      final controller = AppController()
        ..dashboard = buildDashboard(
          notices: <NoticeSummary>[
            buildNotice(id: 'n1', read: false, title: '第一条'),
            buildNotice(id: 'n2', read: false, title: '第二条'),
          ],
          unreadCount: 2,
        );

      expect(controller.unreadNoticeCount, 2);
      expect(controller.canMarkAllNoticesRead, isTrue);

      controller.markNoticeRead(controller.notices.first);

      expect(controller.isNoticeRead(controller.notices.first), isTrue);
      expect(controller.unreadNoticeCount, 1);

      controller.markAllNoticesRead();

      expect(controller.unreadNoticeCount, 0);
      expect(controller.canMarkAllNoticesRead, isFalse);
    },
  );

  testWidgets('NoticesPage exposes read actions and updates unread state', (
    WidgetTester tester,
  ) async {
    final controller = AppController()
      ..dashboard = buildDashboard(
        notices: <NoticeSummary>[
          buildNotice(id: 'n1', read: false, title: '考试安排'),
          buildNotice(id: 'n2', read: false, title: '值日提醒'),
        ],
        unreadCount: 2,
      );

    await pumpWithController(
      tester,
      controller,
      (_) => NoticesPage(controller: controller),
    );

    expect(find.text('全部已读'), findsOneWidget);
    expect(find.text('标为已读'), findsOneWidget);
    expect(find.text('考试安排'), findsWidgets);

    await tester.tap(find.text('全部已读'));
    await tester.pumpAndSettle();

    expect(controller.unreadNoticeCount, 0);
    expect(find.text('当前通知都已经处理完了。'), findsOneWidget);
  });

  testWidgets('SchedulePage renders agenda and weekly schedule', (
    WidgetTester tester,
  ) async {
    final controller = AppController()..dashboard = buildDashboard();

    await pumpWithController(
      tester,
      controller,
      (_) => SchedulePage(controller: controller),
    );

    expect(find.textContaining('的课程'), findsOneWidget);
    expect(find.text('科目列表'), findsOneWidget);
    expect(find.text('本周课表'), findsOneWidget);
    expect(find.text('数学'), findsWidgets);
    expect(find.text('当前没有拿到课表数据。'), findsNothing);
  });
}
