import '../models/models.dart';

DateTime? parseBxbDate(String raw) {
  if (raw.trim().isEmpty) {
    return null;
  }
  final normalized = raw.trim().replaceAll('/', '-');
  return DateTime.tryParse(normalized.replaceFirst(' ', 'T'));
}

String formatDateTime(String raw) {
  final value = parseBxbDate(raw);
  if (value == null) {
    return raw;
  }
  final year = value.year.toString().padLeft(4, '0');
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  final hour = value.hour.toString().padLeft(2, '0');
  final minute = value.minute.toString().padLeft(2, '0');
  return '$year-$month-$day $hour:$minute';
}

String formatShortDateTime(String raw) {
  final value = parseBxbDate(raw);
  if (value == null) {
    return raw;
  }
  final now = DateTime.now();
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  final hour = value.hour.toString().padLeft(2, '0');
  final minute = value.minute.toString().padLeft(2, '0');
  if (value.year == now.year) {
    return '$month-$day $hour:$minute';
  }
  return '${value.year}-$month-$day $hour:$minute';
}

String formatRelativeDeadline(String raw) {
  final value = parseBxbDate(raw);
  if (value == null) {
    return raw.isEmpty ? '--' : raw;
  }

  final now = DateTime.now();
  final startOfToday = DateTime(now.year, now.month, now.day);
  final startOfTarget = DateTime(value.year, value.month, value.day);
  final dayDiff = startOfTarget.difference(startOfToday).inDays;
  final time =
      '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';

  if (dayDiff == 0) {
    return '今天 $time';
  }
  if (dayDiff == 1) {
    return '明天 $time';
  }
  if (dayDiff == -1) {
    return '昨天 $time';
  }
  if (dayDiff > 1 && dayDiff < 7) {
    return '$dayDiff 天后';
  }
  if (dayDiff < -1 && dayDiff > -7) {
    return '${dayDiff.abs()} 天前';
  }
  return formatShortDateTime(raw);
}

int parseTermStartYear(TermSummary term) {
  final match = RegExp(r'(20\d{2})\s*-\s*20\d{2}').firstMatch(term.name);
  return int.tryParse(match?.group(1) ?? '') ?? 0;
}

TermSummary? findCurrentTerm(SessionSummary summary, DashboardData dashboard) {
  for (final term in dashboard.terms) {
    if (term.id == summary.currentTermId) {
      return term;
    }
  }
  for (final term in summary.availableTerms) {
    if (term.id == summary.currentTermId) {
      return term;
    }
  }
  return dashboard.terms.isNotEmpty
      ? dashboard.terms.firstWhere(
          (term) => term.status,
          orElse: () => dashboard.terms.first,
        )
      : (summary.availableTerms.isNotEmpty
            ? summary.availableTerms.first
            : null);
}

({int grade, int ap})? parseApClassLabel(String raw) {
  final compact = raw.replaceAll(RegExp(r'\s+'), '');
  final patterns = <RegExp>[
    RegExp(r'G(\d{1,2})AP(\d{1,2})', caseSensitive: false),
    RegExp(r'APG(\d{1,2})AP(\d{1,2})', caseSensitive: false),
    RegExp(r'高(\d).*?AP(\d{1,2})', caseSensitive: false),
  ];
  for (final pattern in patterns) {
    final match = pattern.firstMatch(compact);
    if (match != null) {
      final grade = int.tryParse(match.group(1) ?? '');
      final ap = int.tryParse(match.group(2) ?? '');
      if (grade != null && ap != null) {
        return (grade: grade, ap: ap);
      }
    }
  }
  return null;
}

String formatApClassLabel(({int grade, int ap}) parsed) {
  return 'G${parsed.grade}AP${parsed.ap}班';
}

String formatClassBadge(SessionSummary summary, DashboardData dashboard) {
  final gpaCandidates = <String>[
    dashboard.gpa?.selectedTransferClass?.className ?? '',
    dashboard.gpa?.selectedTransferClass?.srcClassName ?? '',
  ].where((value) => value.isNotEmpty);

  for (final value in gpaCandidates) {
    final parsed = parseApClassLabel(value);
    if (parsed != null) {
      return formatApClassLabel(parsed);
    }
  }

  final aliasParsed = parseApClassLabel(summary.currentClass?.alias ?? '');
  if (aliasParsed != null) {
    final years = <int>[
      ...summary.availableTerms.map(parseTermStartYear),
      ...dashboard.terms.map(parseTermStartYear),
    ].where((year) => year > 0).toList();
    final latestYear = years.isEmpty
        ? 0
        : years.reduce((a, b) => a > b ? a : b);
    final currentYear = parseTermStartYear(
      findCurrentTerm(summary, dashboard) ??
          TermSummary(id: '', name: '', status: false),
    );
    if (latestYear > 0 && currentYear > 0) {
      final adjustedGrade = aliasParsed.grade - (latestYear - currentYear);
      if (adjustedGrade > 0) {
        return formatApClassLabel((grade: adjustedGrade, ap: aliasParsed.ap));
      }
    }
    return formatApClassLabel(aliasParsed);
  }

  final compactAlias = (summary.currentClass?.alias ?? '').replaceAll(
    RegExp(r'\s+'),
    '',
  );
  if (compactAlias.isNotEmpty) {
    final normalized = compactAlias.toUpperCase();
    return normalized.endsWith('班') ? normalized : '${normalized}班';
  }

  if ((summary.currentClass?.name ?? '').isNotEmpty) {
    return summary.currentClass!.name;
  }
  return '未分配班级';
}

bool isActionableTask(HomeworkTask task) {
  // 未参与的作业
  if ((task.isParticipate ?? 1) == 0) {
    return true;
  }
  // 已参与但等级不是 A+ 的作业
  final grade = task.scoreLevel.trim().toUpperCase();
  return task.isParticipate == 1 && grade.isNotEmpty && grade != 'A+';
}

int gradeRank(String raw) {
  const ranks = <String, int>{
    'E+': 0,
    'E': 1,
    'D+': 2,
    'D': 3,
    'C-': 4,
    'C': 5,
    'C+': 6,
    'B-': 7,
    'B': 8,
    'B+': 9,
    'A-': 10,
    'A': 11,
    'A+': 12,
  };
  return ranks[raw.trim().toUpperCase()] ?? 999;
}

int countRiskTasks(Iterable<HomeworkTask> tasks) {
  return tasks
      .where((task) => task.scoreLevel.toUpperCase().contains('E'))
      .length;
}

List<HomeworkTask> sortTasks(
  Iterable<HomeworkTask> tasks, {
  required bool byLowestGrade,
}) {
  final items = tasks.toList();
  int sortTime(HomeworkTask task) =>
      parseBxbDate(task.endTime)?.millisecondsSinceEpoch ??
      parseBxbDate(task.releaseTime)?.millisecondsSinceEpoch ??
      0;

  if (byLowestGrade) {
    items.sort((a, b) {
      final gradeDiff = gradeRank(a.scoreLevel) - gradeRank(b.scoreLevel);
      if (gradeDiff != 0) {
        return gradeDiff;
      }
      final aTime = sortTime(a);
      final bTime = sortTime(b);
      return aTime.compareTo(bTime);
    });
    return items;
  }

  items.sort((a, b) => sortTime(b).compareTo(sortTime(a)));
  return items;
}

String buildTaskPreview(HomeworkTask task) {
  final parts = <String>[
    if (task.scoreLevel.isNotEmpty) '等级 ${task.scoreLevel}',
    if (task.scoreTypeName.isNotEmpty) task.scoreTypeName,
    if (task.academicScore != null) '分数 ${task.academicScore}',
    if (task.releaseTime.isNotEmpty)
      '发布 ${formatShortDateTime(task.releaseTime)}',
    if (task.endTime.isNotEmpty) '截止 ${formatShortDateTime(task.endTime)}',
    if (task.createName.isNotEmpty) task.createName,
  ];
  return parts.join(' · ');
}

String compactText(String raw, {int maxLength = 120}) {
  final normalized = raw.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return '${normalized.substring(0, maxLength - 1)}…';
}

String formatSessionTimestamp(SessionSummary summary) {
  final capturedAt = summary.capturedAt ?? '';
  if (capturedAt.isEmpty) {
    return '本地会话未标记时间';
  }
  return formatDateTime(
    capturedAt.replaceFirst('T', ' ').replaceFirst('Z', ''),
  );
}

String taskBody(TaskDetail detail) {
  final blocks = <String>[
    detail.contentText.trim(),
    detail.answerText.trim(),
    (detail.rawTask['activityContent'] ?? '').toString().trim(),
  ].where((value) => value.isNotEmpty).toList();
  if (blocks.isNotEmpty) {
    return blocks.join('\n\n');
  }

  final fallback = <String>[
    if ((detail.taskSummary?.activityName ?? '').isNotEmpty)
      '作业：${detail.taskSummary!.activityName}',
    if ((detail.taskSummary?.courseName ?? '').isNotEmpty)
      '科目：${detail.taskSummary!.courseName}',
    if ((detail.rawTask['statusName'] ?? '').toString().isNotEmpty)
      '状态：${detail.rawTask['statusName']}',
    if ((detail.rawTask['creatorName'] ?? '').toString().isNotEmpty)
      '发布老师：${detail.rawTask['creatorName']}',
    if ((detail.taskSummary?.endTime ?? '').isNotEmpty)
      '截止时间：${formatDateTime(detail.taskSummary!.endTime)}',
  ];
  return fallback.join('\n');
}

String basename(String path) {
  final parts = path.split(RegExp(r'[\\/]'));
  return parts.isEmpty ? path : parts.last;
}
