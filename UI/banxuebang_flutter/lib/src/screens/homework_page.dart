import 'package:file_selector/file_selector.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../models/models.dart';
import '../state/app_controller.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';

class HomeworkPage extends StatefulWidget {
  const HomeworkPage({super.key, required this.controller});

  final AppController controller;

  @override
  State<HomeworkPage> createState() => _HomeworkPageState();
}

class _HomeworkPageState extends State<HomeworkPage> {
  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        return _buildContent(context, controller);
      },
    );
  }

  Widget _buildContent(BuildContext context, AppController controller) {
    final dashboard = controller.dashboard!;
    final tasks = controller.visibleTasks;

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final wide = constraints.maxWidth >= 1360;
        final medium = constraints.maxWidth >= 1040;

        final coursePanel = _CoursePanel(
          controller: controller,
          dashboard: dashboard,
        );
        final taskPanel = _TaskPanel(controller: controller, tasks: tasks);
        final detailPanel = _DetailPanel(controller: controller);

        if (wide) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              SizedBox(width: 280, child: coursePanel),
              const SizedBox(width: 16),
              SizedBox(width: 410, child: taskPanel),
              const SizedBox(width: 16),
              Expanded(child: detailPanel),
            ],
          );
        }

        if (medium) {
          return Column(
            children: <Widget>[
              SizedBox(
                height: 320,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Expanded(child: coursePanel),
                    const SizedBox(width: 16),
                    Expanded(flex: 2, child: taskPanel),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Expanded(child: detailPanel),
            ],
          );
        }

        return Column(
          children: <Widget>[
            SizedBox(height: 240, child: coursePanel),
            const SizedBox(height: 16),
            SizedBox(height: 300, child: taskPanel),
            const SizedBox(height: 16),
            Expanded(child: detailPanel),
          ],
        );
      },
    );
  }
}

class _CoursePanel extends StatelessWidget {
  const _CoursePanel({required this.controller, required this.dashboard});

  final AppController controller;
  final DashboardData dashboard;

  @override
  Widget build(BuildContext context) {
    final taskCounts = controller.courseTaskCounts;
    final items = <({String id, String name, int count, String? color})>[
      (id: 'all', name: '全部课程', count: taskCounts['all'] ?? 0, color: null),
      ...dashboard.courses.map(
        (course) => (
          id: course.id,
          name: course.name,
          count: taskCounts[course.id] ?? 0,
          color: course.color,
        ),
      ),
    ];

    return AppPanel(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const _PageSectionHeader(title: '课程筛选', subtitle: '先切到课程，再看右侧任务列表。'),
          const SizedBox(height: 16),
          Expanded(
            child: ListView.separated(
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (BuildContext context, int index) {
                final item = items[index];
                final selected = controller.selectedCourseId == item.id;
                final accent = item.id == 'all'
                    ? const Color(0xFF2563EB)
                    : colorFromHex(
                        item.color,
                        fallback: const Color(0xFF2563EB),
                      );

                return Material(
                  color: Colors.transparent,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: () => controller.selectCourse(item.id),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 150),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: selected
                            ? accent.withValues(alpha: 0.12)
                            : const Color(0xFFF8FAFC),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: selected
                              ? accent.withValues(alpha: 0.25)
                              : const Color(0xFFD8DEE7),
                        ),
                      ),
                      child: Row(
                        children: <Widget>[
                          Container(
                            width: 12,
                            height: 12,
                            decoration: BoxDecoration(
                              color: accent,
                              borderRadius: BorderRadius.circular(99),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Text(
                                  item.name,
                                  style: TextStyle(
                                    color: selected
                                        ? accent
                                        : const Color(0xFF132033),
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  '${item.count} 项任务',
                                  style: const TextStyle(
                                    color: Color(0xFF6B7B91),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          _Capsule(value: item.count),
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

class _TaskPanel extends StatelessWidget {
  const _TaskPanel({required this.controller, required this.tasks});

  final AppController controller;
  final List<HomeworkTask> tasks;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Expanded(
                child: _PageSectionHeader(
                  title: '任务列表',
                  subtitle: '双击并不需要，点一下就会打开详情。',
                ),
              ),
              const SizedBox(width: 12),
              SegmentedButton<TaskSortMode>(
                showSelectedIcon: false,
                segments: const <ButtonSegment<TaskSortMode>>[
                  ButtonSegment<TaskSortMode>(
                    value: TaskSortMode.latest,
                    icon: Icon(CupertinoIcons.clock),
                    label: Text('最新'),
                  ),
                  ButtonSegment<TaskSortMode>(
                    value: TaskSortMode.lowestGrade,
                    icon: Icon(CupertinoIcons.flag),
                    label: Text('等级低'),
                  ),
                ],
                selected: <TaskSortMode>{controller.sortMode},
                onSelectionChanged: (selection) {
                  if (selection.isNotEmpty) {
                    controller.setSortMode(selection.first);
                  }
                },
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (tasks.isEmpty)
            const Expanded(child: Center(child: Text('当前筛选下没有可显示的作业。')))
          else
            Expanded(
              child: ListView.separated(
                itemCount: tasks.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (BuildContext context, int index) {
                  final task = tasks[index];
                  final selected = controller.selectedTaskId == task.id;
                  final accent = (task.isEnd &&
                          task.scoreLevel.toUpperCase().contains('E'))
                      ? const Color(0xFFBE123C)
                      : colorFromHex(
                          task.scoreTypeColor,
                          fallback: const Color(0xFF2563EB),
                        );

                  return Material(
                    color: Colors.transparent,
                    child: InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: () => controller.openTask(task),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 150),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: selected
                              ? accent.withValues(alpha: 0.12)
                              : const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: selected
                                ? accent.withValues(alpha: 0.22)
                                : const Color(0xFFD8DEE7),
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Expanded(
                                  child: Text(
                                    task.activityName.isNotEmpty
                                        ? task.activityName
                                        : '未命名作业',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w800,
                                      height: 1.3,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Text(
                                  formatRelativeDeadline(task.endTime),
                                  style: TextStyle(
                                    color: accent,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              task.courseName.isNotEmpty
                                  ? task.courseName
                                  : '未标记课程',
                              style: const TextStyle(
                                color: Color(0xFF516176),
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            if (controller.classSubmitPercentLabel(task) !=
                                null) ...<Widget>[
                              const SizedBox(height: 6),
                              Text(
                                controller.classSubmitPercentLabel(task)!,
                                style: const TextStyle(
                                  color: Color(0xFF2563EB),
                                  fontWeight: FontWeight.w700,
                                  height: 1.35,
                                ),
                              ),
                            ],
                            const SizedBox(height: 10),
                            Text(
                              buildTaskPreview(task),
                              style: const TextStyle(
                                color: Color(0xFF516176),
                                height: 1.45,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: <Widget>[
                                if (task.scoreTypeName.isNotEmpty)
                                  Chip(label: Text(task.scoreTypeName)),
                                if (task.scoreLevel.isNotEmpty && task.isEnd)
                                  Chip(label: Text('等级 ${task.scoreLevel}')),
                                if (task.academicScore != null)
                                  Chip(label: Text('分数 ${task.academicScore}')),
                                if (!task.isEnd)
                                  _submitStatusChip(task),
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

class _DetailPanel extends StatelessWidget {
  const _DetailPanel({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final detail = controller.selectedTaskDetail;
    final taskSummary = detail?.taskSummary;
    final attachmentMap = <String, AttachmentInfo>{};
    for (final attachment in <AttachmentInfo>[
      ...?detail?.attachments,
      ...?detail?.mySubmissionAttachments,
    ]) {
      attachmentMap[attachment.fileId] = attachment;
    }
    final attachments = attachmentMap.values.toList();

    return AppPanel(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: _PageSectionHeader(
                  title: taskSummary?.activityName ?? '作业详情',
                  subtitle: detail == null
                      ? '从左侧选中一项任务后，这里会显示正文、附件和提交入口。'
                      : '正文、附件和提交通道已经在这里准备好了。',
                ),
              ),
              if (controller.openingTask)
                const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.2),
                ),
            ],
          ),
          const SizedBox(height: 16),
          if (detail == null)
            const Expanded(
              child: Center(
                child: Text(
                  '打开一项作业后开始操作。',
                  style: TextStyle(
                    color: Color(0xFF6B7B91),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            )
          else
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: <Widget>[
                      if ((taskSummary?.courseName ?? '').isNotEmpty)
                        Chip(label: Text(taskSummary!.courseName)),
                      if ((taskSummary?.scoreTypeName ?? '').isNotEmpty)
                        Chip(label: Text(taskSummary!.scoreTypeName)),
                      if ((taskSummary?.scoreLevel ?? '').isNotEmpty &&
                          (taskSummary?.isEnd ?? false))
                        Chip(label: Text('等级 ${taskSummary!.scoreLevel}')),
                      if (taskSummary != null &&
                          controller.classSubmitPercentLabel(taskSummary) !=
                              null)
                        Chip(
                          label: Text(
                            controller.classSubmitPercentLabel(taskSummary)!,
                          ),
                        ),
                      if ((taskSummary?.endTime ?? '').isNotEmpty)
                        Chip(
                          label: Text(
                            '截止 ${formatShortDateTime(taskSummary!.endTime)}',
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Expanded(
                    child: ListView(
                      children: <Widget>[
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF8FAFC),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: const Color(0xFFD8DEE7)),
                          ),
                          child: SelectableText(
                            taskBody(detail).isEmpty
                                ? '这项作业暂时没有可展示的正文内容。'
                                : taskBody(detail),
                            style: const TextStyle(
                              height: 1.6,
                              color: Color(0xFF132033),
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                        const Text(
                          '附件',
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                          ),
                        ),
                        const SizedBox(height: 10),
                        if (attachments.isEmpty)
                          const Text('暂无附件')
                        else
                          Wrap(
                            spacing: 10,
                            runSpacing: 10,
                            children: attachments.map((attachment) {
                              final label = attachment.fileName.isNotEmpty
                                  ? attachment.fileName
                                  : attachment.name;
                              return ActionChip(
                                avatar: const Icon(
                                  CupertinoIcons.paperclip,
                                  size: 16,
                                ),
                                label: Text(label),
                                onPressed: () =>
                                    controller.downloadAttachment(attachment),
                              );
                            }).toList(),
                          ),
                        const SizedBox(height: 18),
                        if (detail.highScoreSubmissions.isNotEmpty) ...<Widget>[
                          const Text(
                            '班级优秀提交',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            '作业已结束，以下是 ${detail.highScoreSubmissions.length} 位同学的 A/A+ 成绩（匿名）',
                            style: const TextStyle(
                              color: Color(0xFF6B7280),
                              fontSize: 13,
                            ),
                          ),
                          const SizedBox(height: 10),
                          ..._buildHighScoreSubmissions(detail),
                          const SizedBox(height: 18),
                        ],
                        const Text(
                          '提交',
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                          ),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: controller.submitRemarkController,
                          minLines: 4,
                          maxLines: 8,
                          decoration: const InputDecoration(
                            labelText: '提交备注',
                            hintText: '可以只写备注，也可以搭配附件一起提交。',
                          ),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 10,
                          runSpacing: 10,
                          children: <Widget>[
                            FilledButton.tonalIcon(
                              onPressed: controller.submitting
                                  ? null
                                  : controller.pickFiles,
                              icon: const Icon(CupertinoIcons.paperclip),
                              label: const Text('选择文件'),
                            ),
                            FilledButton.icon(
                              onPressed: controller.submitting
                                  ? null
                                  : controller.submitSelectedTask,
                              icon: Icon(
                                controller.submitting
                                    ? CupertinoIcons.hourglass
                                    : CupertinoIcons.paperplane,
                              ),
                              label: Text(
                                controller.submitting ? '提交中…' : '提交作业',
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        if (controller.selectedFiles.isEmpty)
                          const Text('还没有选择提交附件。')
                        else
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: controller.selectedFiles.map((
                              XFile file,
                            ) {
                              return InputChip(
                                avatar: const Icon(
                                  CupertinoIcons.doc,
                                  size: 16,
                                ),
                                label: Text(basename(file.path)),
                                onDeleted: () =>
                                    controller.removeSelectedFile(file),
                              );
                            }).toList(),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  List<Widget> _buildHighScoreSubmissions(TaskDetail detail) {
    return detail.highScoreSubmissions.asMap().entries.map((entry) {
      final index = entry.key;
      final submission = entry.value;
      
      return _HighScoreSubmissionCard(
        index: index + 1,
        submission: submission,
      );
    }).toList();
  }
}

class _PageSectionHeader extends StatelessWidget {
  const _PageSectionHeader({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          title,
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: const TextStyle(color: Color(0xFF6B7B91), height: 1.4),
        ),
      ],
    );
  }
}

class _Capsule extends StatelessWidget {
  const _Capsule({required this.value});

  final int value;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 26),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: const Color(0xFF101826),
        borderRadius: BorderRadius.circular(99),
      ),
      alignment: Alignment.center,
      child: Text(
        '$value',
        style: const TextStyle(
          color: Colors.white,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

// 预编译 HTML 清理用的正则，避免每次 build 重新构造
final _reHtmlTags = RegExp(r'<[^>]*>');

class _HighScoreSubmissionCard extends StatefulWidget {
  const _HighScoreSubmissionCard({
    required this.index,
    required this.submission,
  });

  final int index;
  final HighScoreSubmission submission;

  @override
  State<_HighScoreSubmissionCard> createState() => _HighScoreSubmissionCardState();
}

class _HighScoreSubmissionCardState extends State<_HighScoreSubmissionCard> {
  bool _isExpanded = false;

  String _stripHtmlTags(String html) {
    // 简单的HTML标签清理，保留文本内容
    return html
        .replaceAll(_reHtmlTags, '')        // 移除HTML标签
        .replaceAll('&nbsp;', ' ')           // 替换HTML实体
        .replaceAll('&ldquo;', '"')
        .replaceAll('&rdquo;', '"')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .trim();
  }

  @override
  Widget build(BuildContext context) {
    final submission = widget.submission;
    
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFD8DEE7)),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () {
            setState(() {
              _isExpanded = !_isExpanded;
            });
          },
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        color: const Color(0xFF2563EB).withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        '#${widget.index}',
                        style: const TextStyle(
                          color: Color(0xFF2563EB),
                          fontWeight: FontWeight.w800,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            submission.userName ?? 'A同学 #${widget.index}',
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 14,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            formatShortDateTime(submission.receiptTime),
                            style: const TextStyle(
                              color: Color(0xFF6B7280),
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: <Widget>[
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFF10B981).withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            '${submission.score}分',
                            style: const TextStyle(
                              color: Color(0xFF10B981),
                              fontWeight: FontWeight.w800,
                              fontSize: 13,
                            ),
                          ),
                        ),
                        if (submission.level?.isNotEmpty ?? false)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              submission.level!,
                              style: const TextStyle(
                                color: Color(0xFF6B7280),
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(width: 8),
                    Icon(
                      _isExpanded 
                        ? CupertinoIcons.chevron_up 
                        : CupertinoIcons.chevron_down,
                      size: 16,
                      color: const Color(0xFF6B7280),
                    ),
                  ],
                ),
                if (_isExpanded) ...<Widget>[
                  const SizedBox(height: 12),
                  const Divider(height: 1),
                  const SizedBox(height: 12),
                  const Text(
                    '提交内容',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                      color: Color(0xFF6B7280),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: const Color(0xFFE5E7EB)),
                    ),
                    child: SelectableText(
                      submission.remark == null || _stripHtmlTags(submission.remark!).isEmpty 
                        ? '（该同学未填写文字内容）'
                        : _stripHtmlTags(submission.remark!),
                      style: TextStyle(
                        color: submission.remark == null || _stripHtmlTags(submission.remark!).isEmpty 
                          ? const Color(0xFF9CA3AF)
                          : const Color(0xFF374151),
                        fontSize: 13,
                        height: 1.5,
                        fontStyle: submission.remark == null || _stripHtmlTags(submission.remark!).isEmpty 
                          ? FontStyle.italic
                          : FontStyle.normal,
                      ),
                    ),
                  ),
                  if (submission.fileList?.isNotEmpty ?? false) ...<Widget>[
                    const SizedBox(height: 12),
                    const Text(
                      '附件',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                        color: Color(0xFF6B7280),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: submission.fileList!.map((file) {
                        final fileName = file['fileName']?.toString() ?? 
                                       file['name']?.toString() ?? 
                                       '未命名文件';
                        return Chip(
                          avatar: const Icon(
                            CupertinoIcons.doc_fill,
                            size: 14,
                          ),
                          label: Text(
                            fileName,
                            style: const TextStyle(fontSize: 12),
                          ),
                          visualDensity: VisualDensity.compact,
                        );
                      }).toList(),
                    ),
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Widget _submitStatusChip(HomeworkTask task) {
  final correction = task.raw['correction'];
  final needsCorrection =
      correction != null && correction != 0 && correction != false;

  // 需订正
  if (needsCorrection) {
    return Chip(
      avatar: const Icon(CupertinoIcons.exclamationmark_circle,
          size: 14, color: Color(0xFFB45309)),
      label: const Text('需订正',
          style: TextStyle(
              color: Color(0xFFB45309), fontWeight: FontWeight.w700)),
      backgroundColor: const Color(0xFFFEF3C7),
      side: const BorderSide(color: Color(0xFFFCD34D)),
    );
  }

  // 已提交
  if (task.isParticipate == 1) {
    return Chip(
      avatar: const Icon(CupertinoIcons.checkmark_circle,
          size: 14, color: Color(0xFF059669)),
      label: const Text('已提交',
          style: TextStyle(
              color: Color(0xFF059669), fontWeight: FontWeight.w700)),
      backgroundColor: const Color(0xFFD1FAE5),
      side: const BorderSide(color: Color(0xFF6EE7B7)),
    );
  }

  // 未提交（isParticipate == 0 或 null）
  return Chip(
    avatar: const Icon(CupertinoIcons.clock,
        size: 14, color: Color(0xFFDC2626)),
    label: const Text('未提交',
        style: TextStyle(
            color: Color(0xFFDC2626), fontWeight: FontWeight.w700)),
    backgroundColor: const Color(0xFFFEE2E2),
    side: const BorderSide(color: Color(0xFFFCA5A5)),
  );
}
