import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../models/models.dart';
import '../state/app_controller.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';

class NoticesPage extends StatefulWidget {
  const NoticesPage({super.key, required this.controller});

  final AppController controller;

  @override
  State<NoticesPage> createState() => _NoticesPageState();
}

class _NoticesPageState extends State<NoticesPage> {
  String? _selectedNoticeId;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reconcileSelection();
  }

  @override
  void didUpdateWidget(covariant NoticesPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    _reconcileSelection();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (BuildContext context, Widget? child) {
        return _buildContent(context);
      },
    );
  }

  Widget _buildContent(BuildContext context) {
    final notices = widget.controller.notices;
    final selected = notices
        .where((notice) => notice.id == _selectedNoticeId)
        .firstOrNull;

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final wide = constraints.maxWidth >= 1180;
        final listPanel = _NoticeListPanel(
          controller: widget.controller,
          notices: notices,
          selectedNoticeId: _selectedNoticeId,
          onSelected: _selectNotice,
        );
        final detailPanel = _NoticeDetailPanel(
          controller: widget.controller,
          notice: selected,
          onMarkRead: selected == null
              ? null
              : () => _markSelectedRead(selected),
        );

        if (wide) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              SizedBox(width: 400, child: listPanel),
              const SizedBox(width: 12),
              Expanded(child: detailPanel),
            ],
          );
        }

        return Column(
          children: <Widget>[
            SizedBox(height: 340, child: listPanel),
            const SizedBox(height: 12),
            Expanded(child: detailPanel),
          ],
        );
      },
    );
  }

  void _selectNotice(NoticeSummary notice) {
    setState(() => _selectedNoticeId = notice.id);
    widget.controller.markNoticeRead(notice, silent: true);
  }

  void _markSelectedRead(NoticeSummary? notice) {
    if (notice == null) {
      return;
    }
    widget.controller.markNoticeRead(notice);
  }

  void _reconcileSelection() {
    final notices = widget.controller.notices;
    if (notices.isEmpty) {
      _selectedNoticeId = null;
      return;
    }
    final stillExists = notices.any((notice) => notice.id == _selectedNoticeId);
    if (stillExists) {
      return;
    }
    final firstUnread = notices
        .where((notice) => !widget.controller.isNoticeRead(notice))
        .firstOrNull;
    _selectedNoticeId = (firstUnread ?? notices.first).id;
  }
}

class _NoticeListPanel extends StatelessWidget {
  const _NoticeListPanel({
    required this.controller,
    required this.notices,
    required this.selectedNoticeId,
    required this.onSelected,
  });

  final AppController controller;
  final List<NoticeSummary> notices;
  final String? selectedNoticeId;
  final ValueChanged<NoticeSummary> onSelected;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        '消息中心',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        controller.unreadNoticeCount > 0
                            ? '还有 ${controller.unreadNoticeCount} 条未读通知。'
                            : '当前通知都已经处理完了。',
                        style: const TextStyle(
                          color: Color(0xFF6B7280),
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    _StatusBadge(
                      label: controller.unreadNoticeCount > 0
                          ? '未读 ${controller.unreadNoticeCount}'
                          : '已清空',
                      unread: controller.unreadNoticeCount > 0,
                    ),
                    const SizedBox(height: 8),
                    SizedBox(
                      height: 34,
                      child: OutlinedButton.icon(
                        onPressed: controller.canMarkAllNoticesRead
                            ? controller.markAllNoticesRead
                            : null,
                        icon: const Icon(CupertinoIcons.check_mark_circled),
                        label: const Text('全部已读'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: notices.isEmpty
                ? const Center(
                    child: Text(
                      '当前没有通知。',
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
                    itemCount: notices.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 6),
                    itemBuilder: (BuildContext context, int index) {
                      final notice = notices[index];
                      final selected = notice.id == selectedNoticeId;
                      final read = controller.isNoticeRead(notice);

                      return Material(
                        color: Colors.transparent,
                        child: InkWell(
                          borderRadius: BorderRadius.circular(8),
                          onTap: () => onSelected(notice),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 140),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: selected
                                  ? const Color(0xFFE8EEF9)
                                  : read
                                  ? Colors.white.withValues(alpha: 0.4)
                                  : const Color(0xFFFFF7E8),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(
                                color: selected
                                    ? const Color(0x332563EB)
                                    : read
                                    ? const Color(0x141D1D1F)
                                    : const Color(0xFFF3D48B),
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
                                        notice.title.isNotEmpty
                                            ? notice.title
                                            : '未命名通知',
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w800,
                                          height: 1.3,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                    _StatusBadge(
                                      label: read ? '已读' : '未读',
                                      unread: !read,
                                      compact: true,
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  compactText(notice.content, maxLength: 150),
                                  maxLines: 3,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Color(0xFF6B7280),
                                    height: 1.45,
                                  ),
                                ),
                                const SizedBox(height: 10),
                                Text(
                                  '${notice.sender.isEmpty ? '系统' : notice.sender} · ${formatShortDateTime(notice.time)}',
                                  style: const TextStyle(
                                    color: Color(0xFF4B5563),
                                    fontWeight: FontWeight.w700,
                                    fontSize: 12,
                                  ),
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

class _NoticeDetailPanel extends StatelessWidget {
  const _NoticeDetailPanel({
    required this.controller,
    required this.notice,
    required this.onMarkRead,
  });

  final AppController controller;
  final NoticeSummary? notice;
  final VoidCallback? onMarkRead;

  @override
  Widget build(BuildContext context) {
    final currentNotice = notice;
    final read = currentNotice == null
        ? true
        : controller.isNoticeRead(currentNotice);

    return AppPanel(
      padding: const EdgeInsets.all(18),
      child: currentNotice == null
          ? const Center(
              child: Text(
                '左侧选中一条通知后，这里会显示完整正文。',
                style: TextStyle(
                  color: Color(0xFF6B7280),
                  fontWeight: FontWeight.w700,
                ),
              ),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            currentNotice.title.isNotEmpty
                                ? currentNotice.title
                                : '未命名通知',
                            style: Theme.of(context).textTheme.headlineSmall
                                ?.copyWith(
                                  fontWeight: FontWeight.w900,
                                  height: 1.15,
                                ),
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: <Widget>[
                              Chip(
                                avatar: const Icon(
                                  CupertinoIcons.person,
                                  size: 16,
                                ),
                                label: Text(
                                  currentNotice.sender.isEmpty
                                      ? '系统'
                                      : currentNotice.sender,
                                ),
                              ),
                              Chip(
                                avatar: const Icon(
                                  CupertinoIcons.clock,
                                  size: 16,
                                ),
                                label: Text(
                                  currentNotice.time.isEmpty
                                      ? '时间未知'
                                      : formatShortDateTime(currentNotice.time),
                                ),
                              ),
                              Chip(
                                avatar: Icon(
                                  read
                                      ? CupertinoIcons.check_mark_circled
                                      : CupertinoIcons.bell_fill,
                                  size: 16,
                                ),
                                label: Text(read ? '已读' : '未读'),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    SizedBox(
                      height: 36,
                      child: OutlinedButton.icon(
                        onPressed: read ? null : onMarkRead,
                        icon: const Icon(CupertinoIcons.check_mark_circled),
                        label: const Text('标为已读'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Expanded(
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.46),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0x141D1D1F)),
                    ),
                    child: SingleChildScrollView(
                      child: SelectableText(
                        currentNotice.content.isEmpty
                            ? '这条通知没有正文内容。'
                            : currentNotice.content,
                        style: const TextStyle(
                          height: 1.6,
                          color: Color(0xFF111827),
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

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({
    required this.label,
    required this.unread,
    this.compact = false,
  });

  final String label;
  final bool unread;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 8 : 10,
        vertical: compact ? 4 : 7,
      ),
      decoration: BoxDecoration(
        color: unread ? const Color(0xFFFFF3D9) : const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: unread ? const Color(0xFFB45309) : const Color(0xFF516176),
          fontWeight: FontWeight.w800,
          fontSize: compact ? 12 : 13,
        ),
      ),
    );
  }
}
