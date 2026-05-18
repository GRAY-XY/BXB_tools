import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../models/models.dart';
import '../state/app_controller.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';

class OverviewPage extends StatelessWidget {
  const OverviewPage({super.key, required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final dashboard = controller.dashboard!;
    final summary = dashboard.session;
    final tasks = List<HomeworkTask>.from(controller.actionableTasks)
      ..sort((a, b) {
        final aTime = parseBxbDate(a.endTime)?.millisecondsSinceEpoch ?? 0;
        final bTime = parseBxbDate(b.endTime)?.millisecondsSinceEpoch ?? 0;
        return aTime.compareTo(bTime);
      });
    final notices = controller.notices;
    final courseSnapshot = _buildCourseSnapshot(dashboard);

    return SingleChildScrollView(
      padding: const EdgeInsets.only(right: 2),
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final twoColumns = constraints.maxWidth >= 1120;
          final leftColumn = <Widget>[
            _TasksGroup(controller: controller, tasks: tasks),
            const SizedBox(height: 12),
            _NoticesGroup(controller: controller, notices: notices),
          ];
          final rightColumn = <Widget>[
            _AcademicGroup(controller: controller, summary: summary),
            const SizedBox(height: 12),
            _CourseSnapshotGroup(
              dashboard: dashboard,
              nextCourse: courseSnapshot.nextCourse,
              todayCourseCount: courseSnapshot.todayCourseCount,
            ),
          ];

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              _OverviewHero(
                controller: controller,
                dashboard: dashboard,
                nextCourse: courseSnapshot.nextCourse,
                todayCourseCount: courseSnapshot.todayCourseCount,
              ),
              const SizedBox(height: 12),
              if (twoColumns)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Expanded(child: Column(children: leftColumn)),
                    const SizedBox(width: 12),
                    Expanded(child: Column(children: rightColumn)),
                  ],
                )
              else ...<Widget>[
                ...leftColumn,
                const SizedBox(height: 12),
                ...rightColumn,
              ],
            ],
          );
        },
      ),
    );
  }

  ({int todayCourseCount, ({String time, ScheduleCourse course})? nextCourse})
  _buildCourseSnapshot(DashboardData dashboard) {
    final todayWeekday = DateTime.now().weekday;
    final todaySlots =
        dashboard.schedule[todayWeekday] ?? const <int, ScheduleSlot>{};
    final timeKeys = {...dashboard.timeSlots.keys, ...todaySlots.keys}.toList()
      ..sort();
    final todaysCourses = <({String time, ScheduleCourse course})>[
      for (final key in timeKeys)
        if ((todaySlots[key]?.courses.isNotEmpty ?? false))
          (
            time: dashboard.timeSlots[key] ?? todaySlots[key]!.time,
            course: todaySlots[key]!.courses.first,
          ),
    ];

    return (
      todayCourseCount: todaysCourses.length,
      nextCourse: _findNextCourse(todaysCourses),
    );
  }

  ({String time, ScheduleCourse course})? _findNextCourse(
    List<({String time, ScheduleCourse course})> courses,
  ) {
    final now = TimeOfDay.now();
    for (final item in courses) {
      final start = item.time.split('-').firstOrNull ?? '';
      final parts = start.split(':');
      final hour = int.tryParse(parts.firstOrNull ?? '');
      final minute = int.tryParse(parts.length > 1 ? parts[1] : '');
      if (hour == null || minute == null) {
        continue;
      }
      if (hour > now.hour || (hour == now.hour && minute >= now.minute)) {
        return item;
      }
    }
    return null;
  }
}

class _OverviewHero extends StatelessWidget {
  const _OverviewHero({
    required this.controller,
    required this.dashboard,
    required this.nextCourse,
    required this.todayCourseCount,
  });

  final AppController controller;
  final DashboardData dashboard;
  final ({String time, ScheduleCourse course})? nextCourse;
  final int todayCourseCount;

  @override
  Widget build(BuildContext context) {
    final summary = dashboard.session;
    final currentSubject = summary.currentSubject;
    final currentTerm = findCurrentTerm(summary, dashboard);
    final subjectColor = colorFromHex(
      currentSubject?.color,
      fallback: const Color(0xFF2563EB),
    );
    final stats = <({String label, String value, IconData icon})>[
      (
        label: '待处理',
        value: '${controller.pendingCount}',
        icon: CupertinoIcons.doc_on_doc,
      ),
      (
        label: '未读',
        value: '${controller.unreadNoticeCount}',
        icon: CupertinoIcons.bell,
      ),
      (
        label: '风险项',
        value: '${controller.riskCount}',
        icon: CupertinoIcons.exclamationmark_triangle,
      ),
      (
        label: '科目',
        value: '${dashboard.courses.length}',
        icon: CupertinoIcons.book,
      ),
    ];

    return AppPanel(
      frosted: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: subjectColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                alignment: Alignment.center,
                child: Icon(
                  CupertinoIcons.person_crop_circle_fill,
                  color: subjectColor,
                  size: 22,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      summary.user?.name ?? '未登录',
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w900, height: 1.05),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${formatClassBadge(summary, dashboard)} · ${currentSubject?.name.isNotEmpty == true ? currentSubject!.name : '当前未选科目'}',
                      style: const TextStyle(
                        color: Color(0xFF4B5563),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      currentTerm?.name.isNotEmpty == true
                          ? currentTerm!.name
                          : '当前学期未识别',
                      style: const TextStyle(
                        color: Color(0xFF6B7280),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 7,
                ),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.58),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0x141D1D1F)),
                ),
                child: Text(
                  formatSessionTimestamp(summary),
                  style: const TextStyle(
                    color: Color(0xFF4B5563),
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: stats
                .map(
                  (stat) => _StatPill(
                    icon: stat.icon,
                    label: stat.label,
                    value: stat.value,
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 16),
          Row(
            children: <Widget>[
              Expanded(
                child: _FocusTile(
                  title: '今天课程',
                  value: todayCourseCount > 0 ? '$todayCourseCount 节' : '今天没课',
                  detail: nextCourse == null
                      ? '课程安排已经结束，详细时间表在课程页。'
                      : '下一节 ${nextCourse!.course.name}，${nextCourse!.time} 开始。',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _FocusTile(
                  title: '当前重点',
                  value: controller.pendingCount > 0
                      ? '还有 ${controller.pendingCount} 项待处理'
                      : '今天没有待交作业',
                  detail: controller.riskCount > 0
                      ? '${controller.riskCount} 项风险作业建议优先看。'
                      : '目前没有明显的风险项。',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TasksGroup extends StatelessWidget {
  const _TasksGroup({required this.controller, required this.tasks});

  final AppController controller;
  final List<HomeworkTask> tasks;

  @override
  Widget build(BuildContext context) {
    return _GroupPanel(
      title: '待处理作业',
      subtitle: tasks.isEmpty ? '当前没有待处理任务。' : '先处理最靠近截止时间的任务。',
      child: tasks.isEmpty
          ? const _EmptyState(label: '现在可以喘口气。')
          : Column(
              children: tasks.take(5).map((task) {
                final accent = task.scoreLevel.toUpperCase().contains('E')
                    ? const Color(0xFFBE123C)
                    : colorFromHex(
                        task.scoreTypeColor,
                        fallback: const Color(0xFF2563EB),
                      );
                return _ListRow(
                  leading: _ColorDot(color: accent),
                  title: task.activityName.isNotEmpty
                      ? task.activityName
                      : '未命名作业',
                  subtitle:
                      '${task.courseName.isEmpty ? '未标记课程' : task.courseName} · ${formatRelativeDeadline(task.endTime)}',
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      if (task.scoreLevel.isNotEmpty)
                        _MiniTag(label: task.scoreLevel),
                      if (task.academicScore != null) ...<Widget>[
                        const SizedBox(width: 6),
                        _MiniTag(label: '${task.academicScore}'),
                      ],
                    ],
                  ),
                );
              }).toList(),
            ),
    );
  }
}

class _NoticesGroup extends StatelessWidget {
  const _NoticesGroup({required this.controller, required this.notices});

  final AppController controller;
  final List<NoticeSummary> notices;

  @override
  Widget build(BuildContext context) {
    return _GroupPanel(
      title: '最近通知',
      subtitle: controller.unreadNoticeCount > 0
          ? '还有 ${controller.unreadNoticeCount} 条未读消息。'
          : '通知已经清到零了。',
      child: notices.isEmpty
          ? const _EmptyState(label: '当前没有通知。')
          : Column(
              children: notices.take(4).map((notice) {
                final read = controller.isNoticeRead(notice);
                return _ListRow(
                  leading: Icon(
                    read ? CupertinoIcons.bell : CupertinoIcons.bell_fill,
                    size: 17,
                    color: read
                        ? const Color(0xFF6B7280)
                        : const Color(0xFFB45309),
                  ),
                  title: notice.title.isNotEmpty ? notice.title : '未命名通知',
                  subtitle:
                      '${notice.sender.isEmpty ? '系统' : notice.sender} · ${formatShortDateTime(notice.time)} · ${compactText(notice.content, maxLength: 56)}',
                  trailing: !read ? const _MiniTag(label: '未读') : null,
                );
              }).toList(),
            ),
    );
  }
}

class _AcademicGroup extends StatelessWidget {
  const _AcademicGroup({required this.controller, required this.summary});

  final AppController controller;
  final SessionSummary summary;

  @override
  Widget build(BuildContext context) {
    final dashboard = controller.dashboard!;
    final course = dashboard.courses
        .where((item) => item.id == summary.currentSubject?.id)
        .firstOrNull;
    final teachers = (course?.teacherList ?? const <JsonMap>[])
        .map((item) => (item['userName'] ?? '').toString().trim())
        .where((name) => name.isNotEmpty)
        .toList();

    return _GroupPanel(
      title: '学业概览',
      subtitle: summary.currentSubject?.name.isNotEmpty == true
          ? summary.currentSubject!.name
          : '当前未选科目',
      child: Column(
        children: <Widget>[
          _MetricRow(
            icon: CupertinoIcons.chart_bar_alt_fill,
            label: '平均等级',
            value: (dashboard.gpa?.averageLevel ?? '').isNotEmpty
                ? dashboard.gpa!.averageLevel!
                : '--',
          ),
          _MetricRow(
            icon: CupertinoIcons.doc_plaintext,
            label: '成绩记录',
            value: '${dashboard.gpa?.achievementCount ?? 0}',
          ),
          _MetricRow(
            icon: CupertinoIcons.layers_alt,
            label: '等级档位',
            value: '${dashboard.gpa?.scoreLevelCount ?? 0}',
          ),
          _MetricRow(
            icon: CupertinoIcons.person_2_fill,
            label: '任课老师',
            value: teachers.isEmpty ? '未提供' : teachers.take(3).join('、'),
          ),
        ],
      ),
    );
  }
}

class _CourseSnapshotGroup extends StatelessWidget {
  const _CourseSnapshotGroup({
    required this.dashboard,
    required this.nextCourse,
    required this.todayCourseCount,
  });

  final DashboardData dashboard;
  final ({String time, ScheduleCourse course})? nextCourse;
  final int todayCourseCount;

  @override
  Widget build(BuildContext context) {
    final summary = dashboard.session;
    final currentTerm = findCurrentTerm(summary, dashboard);

    return _GroupPanel(
      title: '课程概况',
      subtitle: '首页只放摘要，完整时间表和课程列表在课程页。',
      child: Column(
        children: <Widget>[
          _MetricRow(
            icon: CupertinoIcons.calendar_today,
            label: '今天课程',
            value: todayCourseCount > 0 ? '$todayCourseCount 节' : '无',
          ),
          _MetricRow(
            icon: CupertinoIcons.arrow_right_circle,
            label: '下一节',
            value: nextCourse == null
                ? '今天已结束'
                : '${nextCourse!.course.name} · ${nextCourse!.time}',
          ),
          _MetricRow(
            icon: CupertinoIcons.book,
            label: '已加载科目',
            value: '${dashboard.courses.length}',
          ),
          _MetricRow(
            icon: CupertinoIcons.flag,
            label: '当前学期',
            value: currentTerm?.name.isNotEmpty == true
                ? currentTerm!.name
                : '--',
          ),
        ],
      ),
    );
  }
}

class _GroupPanel extends StatelessWidget {
  const _GroupPanel({
    required this.title,
    required this.subtitle,
    required this.child,
  });

  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  title,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: Color(0xFF6B7280),
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: child,
          ),
        ],
      ),
    );
  }
}

class _ListRow extends StatelessWidget {
  const _ListRow({
    required this.leading,
    required this.title,
    required this.subtitle,
    this.trailing,
  });

  final Widget leading;
  final String title;
  final String subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0x141D1D1F))),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(padding: const EdgeInsets.only(top: 2), child: leading),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF111827),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: Color(0xFF6B7280),
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          if (trailing != null) ...<Widget>[
            const SizedBox(width: 10),
            trailing!,
          ],
        ],
      ),
    );
  }
}

class _StatPill extends StatelessWidget {
  const _StatPill({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.52),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0x141D1D1F)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 16, color: const Color(0xFF4B5563)),
          const SizedBox(width: 8),
          Text(
            '$label ',
            style: const TextStyle(
              color: Color(0xFF6B7280),
              fontWeight: FontWeight.w700,
            ),
          ),
          Text(
            value,
            style: const TextStyle(
              color: Color(0xFF111827),
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _FocusTile extends StatelessWidget {
  const _FocusTile({
    required this.title,
    required this.value,
    required this.detail,
  });

  final String title;
  final String value;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.42),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0x141D1D1F)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            title,
            style: const TextStyle(
              color: Color(0xFF4B5563),
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: const TextStyle(
              color: Color(0xFF111827),
              fontSize: 24,
              fontWeight: FontWeight.w900,
              height: 1.1,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            detail,
            style: const TextStyle(color: Color(0xFF6B7280), height: 1.35),
          ),
        ],
      ),
    );
  }
}

class _MetricRow extends StatelessWidget {
  const _MetricRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0x141D1D1F))),
      ),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 16, color: const Color(0xFF6B7280)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF4B5563),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: Color(0xFF111827),
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ColorDot extends StatelessWidget {
  const _ColorDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(99),
      ),
    );
  }
}

class _MiniTag extends StatelessWidget {
  const _MiniTag({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF475569),
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 18),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF6B7280),
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
