import 'dart:math' as math;

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../models/models.dart';
import '../state/app_controller.dart';
import '../theme/app_theme.dart';

class SchedulePage extends StatefulWidget {
  const SchedulePage({super.key, required this.controller});

  final AppController controller;

  @override
  State<SchedulePage> createState() => _SchedulePageState();
}

class _SchedulePageState extends State<SchedulePage> {
  final ScrollController _horizontalController = ScrollController();
  final ScrollController _verticalController = ScrollController();

  static const Map<int, String> _weekdayLabels = <int, String>{
    1: '周一',
    2: '周二',
    3: '周三',
    4: '周四',
    5: '周五',
    6: '周六',
    7: '周日',
  };

  @override
  void dispose() {
    _horizontalController.dispose();
    _verticalController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final dashboard = controller.dashboard!;
    final timeKeys = _resolveTimeKeys(dashboard);
    final dayKeys = _resolveDayKeys(dashboard);
    final todayKey = _weekdayLabels.containsKey(DateTime.now().weekday)
        ? DateTime.now().weekday
        : dayKeys.firstOrNull ?? 1;
    final todayAgenda = _buildTodayAgenda(dashboard, todayKey, timeKeys);
    final currentLesson = _findCurrentLesson(timeKeys, dashboard.timeSlots);
    final nextLesson = _findNextLesson(timeKeys, dashboard.timeSlots);
    final hasScheduleData = dayKeys.any(
      (day) => (dashboard.schedule[day] ?? const <int, ScheduleSlot>{}).values
          .any((slot) => slot.courses.isNotEmpty),
    );

    return Expanded(
      child: hasScheduleData
          ? LayoutBuilder(
              builder: (BuildContext context, BoxConstraints constraints) {
                final wide = constraints.maxWidth >= 1220;
                final compactHeight = constraints.maxHeight < 760;
                    final weeklyPanel = _WeeklySchedulePanel(
                      dashboard: dashboard,
                      timeKeys: timeKeys,
                      dayKeys: dayKeys,
                      dayLabels: _weekdayLabels,
                      todayKey: todayKey,
                      currentLesson: currentLesson,
                      horizontalController: _horizontalController,
                      verticalController: _verticalController,
                    );
                    final leftRail = Column(
                      children: <Widget>[
                        Expanded(
                          flex: 8,
                          child: _TodayAgendaPanel(
                            todayLabel: _weekdayLabels[todayKey] ?? '今天',
                            entries: todayAgenda,
                            currentLesson: currentLesson,
                            nextLesson: nextLesson,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Expanded(
                          flex: 7,
                          child: _CourseCatalogPanel(controller: controller),
                        ),
                      ],
                    );

                    if (wide) {
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          SizedBox(width: 340, child: leftRail),
                          const SizedBox(width: 12),
                          Expanded(child: weeklyPanel),
                        ],
                      );
                    }

                    if (compactHeight) {
                      return SingleChildScrollView(
                        padding: const EdgeInsets.only(right: 2),
                        child: Column(
                          children: <Widget>[
                            SizedBox(
                              height: 280,
                              child: _TodayAgendaPanel(
                                todayLabel: _weekdayLabels[todayKey] ?? '今天',
                                entries: todayAgenda,
                                currentLesson: currentLesson,
                                nextLesson: nextLesson,
                              ),
                            ),
                            const SizedBox(height: 12),
                            SizedBox(
                              height: 220,
                              child: _CourseCatalogPanel(
                                controller: controller,
                              ),
                            ),
                            const SizedBox(height: 12),
                            SizedBox(
                              height: math.max(
                                380,
                                constraints.maxHeight * 0.82,
                              ),
                              child: weeklyPanel,
                            ),
                          ],
                        ),
                      );
                    }

                    return Column(
                      children: <Widget>[
                        Expanded(
                          flex: 7,
                          child: _TodayAgendaPanel(
                            todayLabel: _weekdayLabels[todayKey] ?? '今天',
                            entries: todayAgenda,
                            currentLesson: currentLesson,
                            nextLesson: nextLesson,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Expanded(
                          flex: 5,
                          child: _CourseCatalogPanel(controller: controller),
                        ),
                        const SizedBox(height: 12),
                        Expanded(flex: 12, child: weeklyPanel),
                      ],
                    );
                  },
                )
              : _EmptySchedulePanel(controller: controller),
    );
  }

  List<int> _resolveTimeKeys(DashboardData dashboard) {
    final keys = <int>{
      ...dashboard.timeSlots.keys,
      for (final daySlots in dashboard.schedule.values) ...daySlots.keys,
    }.toList()..sort();
    return keys;
  }

  List<int> _resolveDayKeys(DashboardData dashboard) {
    final keys =
        dashboard.schedule.keys.where(_weekdayLabels.containsKey).toList()
          ..sort();
    return keys.isEmpty ? <int>[1, 2, 3, 4, 5] : keys;
  }

  List<_AgendaEntry> _buildTodayAgenda(
    DashboardData dashboard,
    int todayKey,
    List<int> timeKeys,
  ) {
    final daySlots =
        dashboard.schedule[todayKey] ?? const <int, ScheduleSlot>{};
    return <_AgendaEntry>[
      for (final key in timeKeys)
        if ((daySlots[key]?.courses.isNotEmpty ?? false))
          _AgendaEntry(
            lesson: key,
            time: dashboard.timeSlots[key] ?? daySlots[key]!.time,
            course: daySlots[key]!.courses.first,
          ),
    ];
  }

  int? _findCurrentLesson(List<int> timeKeys, Map<int, String> timeSlots) {
    final now = TimeOfDay.now();
    final nowMinutes = now.hour * 60 + now.minute;
    for (final lesson in timeKeys) {
      final range = _parseTimeRange(timeSlots[lesson] ?? '');
      if (range == null) {
        continue;
      }
      if (nowMinutes >= range.$1 && nowMinutes < range.$2) {
        return lesson;
      }
    }
    return null;
  }

  int? _findNextLesson(List<int> timeKeys, Map<int, String> timeSlots) {
    final now = TimeOfDay.now();
    final nowMinutes = now.hour * 60 + now.minute;
    for (final lesson in timeKeys) {
      final range = _parseTimeRange(timeSlots[lesson] ?? '');
      if (range == null) {
        continue;
      }
      if (range.$1 > nowMinutes) {
        return lesson;
      }
    }
    return null;
  }

  (int, int)? _parseTimeRange(String raw) {
    final parts = raw.split('-');
    if (parts.length != 2) {
      return null;
    }
    final start = _parseClock(parts.first);
    final end = _parseClock(parts.last);
    if (start == null || end == null) {
      return null;
    }
    return (start, end);
  }

  int? _parseClock(String raw) {
    final pieces = raw.trim().split(':');
    final hour = int.tryParse(pieces.firstOrNull ?? '');
    final minute = int.tryParse(pieces.length > 1 ? pieces[1] : '');
    if (hour == null || minute == null) {
      return null;
    }
    return hour * 60 + minute;
  }
}

class _TodayAgendaPanel extends StatelessWidget {
  const _TodayAgendaPanel({
    required this.todayLabel,
    required this.entries,
    required this.currentLesson,
    required this.nextLesson,
  });

  final String todayLabel;
  final List<_AgendaEntry> entries;
  final int? currentLesson;
  final int? nextLesson;

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
                  '$todayLabel 的课程',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  entries.isEmpty
                      ? '今天没有课程安排。'
                      : currentLesson != null
                      ? '当前正在上课，下面按节次排好。'
                      : nextLesson != null
                      ? '下一节课已经帮你标出来了。'
                      : '今天的课程已经全部结束。',
                  style: const TextStyle(
                    color: Color(0xFF6B7280),
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: entries.isEmpty
                ? const Center(
                    child: Text(
                      '今天没有排课。',
                      style: TextStyle(
                        color: Color(0xFF6B7280),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 8,
                    ),
                    itemCount: entries.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 6),
                    itemBuilder: (BuildContext context, int index) {
                      final entry = entries[index];
                      final accent = colorFromHex(
                        entry.course.color,
                        fallback: const Color(0xFF2563EB),
                      );
                      final isCurrent = currentLesson == entry.lesson;
                      final isNext = nextLesson == entry.lesson;

                      return Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: isCurrent
                              ? accent.withValues(alpha: 0.14)
                              : isNext
                              ? accent.withValues(alpha: 0.1)
                              : Colors.white.withValues(alpha: 0.42),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: isCurrent
                                ? accent.withValues(alpha: 0.35)
                                : const Color(0x141D1D1F),
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Row(
                              children: <Widget>[
                                Expanded(
                                  child: Text(
                                    entry.time.isNotEmpty ? entry.time : '未排时间',
                                    style: const TextStyle(
                                      color: Color(0xFF4B5563),
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                                if (isCurrent) const _ScheduleTag(label: '当前'),
                                if (!isCurrent && isNext)
                                  const _ScheduleTag(label: '下一节'),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              entry.course.name.isNotEmpty
                                  ? entry.course.name
                                  : '未命名课程',
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                color: Color(0xFF111827),
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '${entry.course.teacher.isEmpty ? '未提供教师' : entry.course.teacher}${entry.course.room.isEmpty ? '' : ' · ${entry.course.room}'}',
                              style: const TextStyle(
                                color: Color(0xFF6B7280),
                                height: 1.35,
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _CourseCatalogPanel extends StatelessWidget {
  const _CourseCatalogPanel({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final dashboard = controller.dashboard!;
    final courses = List<CourseSummary>.from(dashboard.courses)
      ..sort((a, b) {
        final aSelected = a.id == dashboard.session.currentSubject?.id ? 1 : 0;
        final bSelected = b.id == dashboard.session.currentSubject?.id ? 1 : 0;
        if (aSelected != bSelected) {
          return bSelected.compareTo(aSelected);
        }
        final pendingCompare = b.unSubmitCount.compareTo(a.unSubmitCount);
        if (pendingCompare != 0) {
          return pendingCompare;
        }
        return a.name.compareTo(b.name);
      });

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
                  '科目列表',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  '这里可以快速看每门课的待交数量，也能直接切换当前科目。',
                  style: TextStyle(color: Color(0xFF6B7280), height: 1.35),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: courses.isEmpty
                ? const Center(
                    child: Text(
                      '当前没有课程信息。',
                      style: TextStyle(
                        color: Color(0xFF6B7280),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 8,
                    ),
                    itemCount: courses.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 6),
                    itemBuilder: (BuildContext context, int index) {
                      final course = courses[index];
                      final subject = controller.subjectForCourse(course);
                      final selected =
                          course.id == dashboard.session.currentSubject?.id;
                      final teachers = (course.teacherList)
                          .map(
                            (item) =>
                                (item['userName'] ?? '').toString().trim(),
                          )
                          .where((name) => name.isNotEmpty)
                          .toList();
                      final accent = colorFromHex(
                        course.color,
                        fallback: const Color(0xFF2563EB),
                      );

                      return Material(
                        color: Colors.transparent,
                        child: InkWell(
                          borderRadius: BorderRadius.circular(8),
                          onTap:
                              (!selected &&
                                  subject != null &&
                                  !controller.changingSubject)
                              ? () => controller.setCurrentSubject(subject)
                              : null,
                          child: Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: selected
                                  ? const Color(0xFFE8EEF9)
                                  : Colors.white.withValues(alpha: 0.42),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(
                                color: selected
                                    ? const Color(0x332563EB)
                                    : const Color(0x141D1D1F),
                              ),
                            ),
                            child: Row(
                              children: <Widget>[
                                Container(
                                  width: 10,
                                  height: 10,
                                  decoration: BoxDecoration(
                                    color: accent,
                                    borderRadius: BorderRadius.circular(99),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: <Widget>[
                                      Text(
                                        course.name.isNotEmpty
                                            ? course.name
                                            : '未命名课程',
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w800,
                                          color: Color(0xFF111827),
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        teachers.isEmpty
                                            ? '教师信息未提供'
                                            : teachers.take(2).join('、'),
                                        style: const TextStyle(
                                          color: Color(0xFF6B7280),
                                          height: 1.35,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: <Widget>[
                                    Text(
                                      course.unSubmitCount > 0
                                          ? '待交 ${course.unSubmitCount}'
                                          : '已清空',
                                      style: const TextStyle(
                                        color: Color(0xFF4B5563),
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                    _ScheduleTag(
                                      label: selected ? '当前科目' : '切换',
                                      subtle: !selected,
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _WeeklySchedulePanel extends StatelessWidget {
  const _WeeklySchedulePanel({
    required this.dashboard,
    required this.timeKeys,
    required this.dayKeys,
    required this.dayLabels,
    required this.todayKey,
    required this.currentLesson,
    required this.horizontalController,
    required this.verticalController,
  });

  final DashboardData dashboard;
  final List<int> timeKeys;
  final List<int> dayKeys;
  final Map<int, String> dayLabels;
  final int todayKey;
  final int? currentLesson;
  final ScrollController horizontalController;
  final ScrollController verticalController;

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
                  '本周课表',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '按节次查看整周课程，当前日期会高亮显示。',
                  style: const TextStyle(
                    color: Color(0xFF6B7280),
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: Scrollbar(
              controller: horizontalController,
              child: SingleChildScrollView(
                controller: horizontalController,
                scrollDirection: Axis.horizontal,
                child: SizedBox(
                  width: math.max(960, dayKeys.length * 210 + 170),
                  child: Scrollbar(
                    controller: verticalController,
                    child: SingleChildScrollView(
                      controller: verticalController,
                      child: Column(
                        children: <Widget>[
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 14,
                            ),
                            decoration: const BoxDecoration(
                              border: Border(
                                bottom: BorderSide(color: Color(0x141D1D1F)),
                              ),
                            ),
                            child: Row(
                              children: <Widget>[
                                const SizedBox(
                                  width: 150,
                                  child: Text(
                                    '时间',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w800,
                                      color: Color(0xFF4B5563),
                                    ),
                                  ),
                                ),
                                for (final day in dayKeys)
                                  Expanded(
                                    child: Padding(
                                      padding: const EdgeInsets.only(right: 10),
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 12,
                                          vertical: 10,
                                        ),
                                        decoration: BoxDecoration(
                                          color: day == todayKey
                                              ? const Color(0xFFE8EEF9)
                                              : Colors.transparent,
                                          borderRadius: BorderRadius.circular(
                                            8,
                                          ),
                                        ),
                                        child: Text(
                                          dayLabels[day] ?? '周$day',
                                          style: TextStyle(
                                            fontWeight: FontWeight.w800,
                                            color: day == todayKey
                                                ? const Color(0xFF1D4ED8)
                                                : const Color(0xFF4B5563),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          for (final slot in timeKeys)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 12,
                              ),
                              decoration: const BoxDecoration(
                                border: Border(
                                  bottom: BorderSide(color: Color(0x141D1D1F)),
                                ),
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: <Widget>[
                                  SizedBox(
                                    width: 150,
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: <Widget>[
                                        Text(
                                          '第 ${slot + 1} 节',
                                          style: TextStyle(
                                            fontWeight: FontWeight.w800,
                                            color: currentLesson == slot
                                                ? const Color(0xFF1D4ED8)
                                                : const Color(0xFF111827),
                                          ),
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          dashboard.timeSlots[slot] ?? '未排时间',
                                          style: const TextStyle(
                                            color: Color(0xFF6B7280),
                                            height: 1.35,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  for (final day in dayKeys)
                                    Expanded(
                                      child: Padding(
                                        padding: const EdgeInsets.only(
                                          right: 10,
                                        ),
                                        child: _WeekSlotCell(
                                          slot:
                                              dashboard.schedule[day]?[slot] ??
                                              ScheduleSlot(
                                                time:
                                                    dashboard.timeSlots[slot] ??
                                                    '',
                                                courses:
                                                    const <ScheduleCourse>[],
                                              ),
                                          dayIsToday: day == todayKey,
                                          isCurrentLesson:
                                              day == todayKey &&
                                              currentLesson == slot,
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _WeekSlotCell extends StatelessWidget {
  const _WeekSlotCell({
    required this.slot,
    required this.dayIsToday,
    required this.isCurrentLesson,
  });

  final ScheduleSlot slot;
  final bool dayIsToday;
  final bool isCurrentLesson;

  @override
  Widget build(BuildContext context) {
    if (slot.courses.isEmpty) {
      return Container(
        constraints: const BoxConstraints(minHeight: 86),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: dayIsToday
              ? const Color(0xFFF8FBFF)
              : Colors.white.withValues(alpha: 0.36),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isCurrentLesson
                ? const Color(0x332563EB)
                : const Color(0x141D1D1F),
          ),
        ),
        child: const Text(
          '空课时',
          style: TextStyle(
            color: Color(0xFF6B7280),
            fontWeight: FontWeight.w700,
          ),
        ),
      );
    }

    final course = slot.courses.first;
    final accent = colorFromHex(
      course.color,
      fallback: const Color(0xFF2563EB),
    );

    return Container(
      constraints: const BoxConstraints(minHeight: 86),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: isCurrentLesson ? 0.16 : 0.09),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: isCurrentLesson
              ? accent.withValues(alpha: 0.36)
              : accent.withValues(alpha: 0.18),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            course.name.isNotEmpty ? course.name : '未命名课程',
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              color: Color(0xFF111827),
              height: 1.25,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '${course.teacher.isEmpty ? '未提供教师' : course.teacher}${course.room.isEmpty ? '' : ' · ${course.room}'}',
            style: const TextStyle(color: Color(0xFF4B5563), height: 1.35),
          ),
        ],
      ),
    );
  }
}

class _EmptySchedulePanel extends StatelessWidget {
  const _EmptySchedulePanel({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(
              CupertinoIcons.calendar,
              size: 32,
              color: Color(0xFF6B7280),
            ),
            const SizedBox(height: 12),
            const Text(
              '当前没有拿到课表数据。',
              style: TextStyle(
                fontWeight: FontWeight.w800,
                color: Color(0xFF111827),
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              '通常是学期或班级上下文还不完整，刷新一次会更稳。',
              style: TextStyle(color: Color(0xFF6B7280), height: 1.35),
            ),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: controller.refreshing
                  ? null
                  : controller.refreshDashboard,
              icon: const Icon(CupertinoIcons.refresh),
              label: Text(controller.refreshing ? '刷新中' : '刷新课表'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScheduleTag extends StatelessWidget {
  const _ScheduleTag({required this.label, this.subtle = false});

  final String label;
  final bool subtle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: subtle ? const Color(0xFFF1F5F9) : const Color(0xFFE8EEF9),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: subtle ? const Color(0xFF516176) : const Color(0xFF1D4ED8),
          fontSize: 12,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _AgendaEntry {
  const _AgendaEntry({
    required this.lesson,
    required this.time,
    required this.course,
  });

  final int lesson;
  final String time;
  final ScheduleCourse course;
}
