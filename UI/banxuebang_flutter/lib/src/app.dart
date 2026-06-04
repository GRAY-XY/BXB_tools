import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import 'screens/homework_page.dart';
import 'screens/login_screen.dart';
import 'screens/messages_page.dart';
import 'screens/notices_page.dart';
import 'screens/overview_page.dart';
import 'screens/schedule_page.dart';
import 'state/app_controller.dart';
import 'theme/app_theme.dart';
import 'utils/formatters.dart';

class BanxuebangFlutterApp extends StatefulWidget {
  const BanxuebangFlutterApp({super.key});

  @override
  State<BanxuebangFlutterApp> createState() => _BanxuebangFlutterAppState();
}

class _BanxuebangFlutterAppState extends State<BanxuebangFlutterApp> {
  late final AppController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AppController()..initialize();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '班学帮 Student',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: AnimatedBuilder(
        animation: _controller,
        builder: (BuildContext context, Widget? child) {
          if (_controller.booting && _controller.dashboard == null) {
            return const _SplashScreen();
          }

          if (!_controller.isLoggedIn) {
            return Scaffold(
              body: Column(
                children: <Widget>[
                  if ((_controller.bannerMessage ?? '').isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                      child: BannerStrip(
                        message: _controller.bannerMessage!,
                        isError: _controller.bannerIsError,
                        onClose: _controller.clearBanner,
                      ),
                    ),
                  Expanded(child: LoginScreen(controller: _controller)),
                ],
              ),
            );
          }

          return _DesktopShell(controller: _controller);
        },
      ),
    );
  }
}

enum _ShellSection { overview, homework, schedule, notices, messages }

class _DesktopShell extends StatefulWidget {
  const _DesktopShell({required this.controller});

  final AppController controller;

  @override
  State<_DesktopShell> createState() => _DesktopShellState();
}

class _DesktopShellState extends State<_DesktopShell> {
  _ShellSection _section = _ShellSection.overview;

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final dashboard = controller.dashboard!;
    final summary = dashboard.session;
    final currentTerm = findCurrentTerm(summary, dashboard);
    final view = _shellViews(controller)[_section]!;

    return Scaffold(
      body: DecoratedBox(
        decoration: const BoxDecoration(color: Color(0xFFF1F1EE)),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: LayoutBuilder(
              builder: (BuildContext context, BoxConstraints constraints) {
                final expandedSidebar = constraints.maxWidth >= 1120;

                return Row(
                  children: <Widget>[
                    SizedBox(
                      width: expandedSidebar ? 220 : 86,
                      child: _Sidebar(
                        controller: controller,
                        section: _section,
                        expanded: expandedSidebar,
                        onSectionSelected: (section) {
                          setState(() => _section = section);
                        },
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        children: <Widget>[
                          _Toolbar(
                            controller: controller,
                            title: view.title,
                            subtitle: view.subtitle,
                            currentTermId: currentTerm?.id,
                          ),
                          if ((controller.bannerMessage ?? '').isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: BannerStrip(
                                message: controller.bannerMessage!,
                                isError: controller.bannerIsError,
                                onClose: controller.clearBanner,
                              ),
                            ),
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: AnimatedSwitcher(
                                duration: const Duration(milliseconds: 200),
                                switchInCurve: Curves.easeOutCubic,
                                switchOutCurve: Curves.easeInCubic,
                                child: KeyedSubtree(
                                  key: ValueKey<_ShellSection>(_section),
                                  child: view.child,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Map<_ShellSection, ({String title, String subtitle, Widget child})>
  _shellViews(AppController controller) {
    return <_ShellSection, ({String title, String subtitle, Widget child})>{
      _ShellSection.overview: (
        title: '工作台',
        subtitle: '首页只放摘要，待办、通知、学业和课程概况都会收在这里。',
        child: OverviewPage(controller: controller),
      ),
      _ShellSection.homework: (
        title: '作业',
        subtitle: '按课程切换任务，打开详情后直接提交。',
        child: HomeworkPage(controller: controller),
      ),
      _ShellSection.schedule: (
        title: '课程',
        subtitle: '今天课程、科目列表和整周课表都集中在这里。',
        child: SchedulePage(controller: controller),
      ),
      _ShellSection.notices: (
        title: '通知',
        subtitle: '最近公告和未读提醒都在这里。',
        child: NoticesPage(controller: controller),
      ),
      _ShellSection.messages: (
        title: '私信',
        subtitle: '与老师的私信会话。',
        child: MessagesPage(controller: controller),
      ),
    };
  }
}

class _Sidebar extends StatelessWidget {
  const _Sidebar({
    required this.controller,
    required this.section,
    required this.expanded,
    required this.onSectionSelected,
  });

  final AppController controller;
  final _ShellSection section;
  final bool expanded;
  final ValueChanged<_ShellSection> onSectionSelected;

  @override
  Widget build(BuildContext context) {
    final dashboard = controller.dashboard!;
    final summary = dashboard.session;
    final items = <_NavItem>[
      _NavItem(
        section: _ShellSection.overview,
        icon: CupertinoIcons.square_grid_2x2,
        label: '工作台',
      ),
      _NavItem(
        section: _ShellSection.homework,
        icon: CupertinoIcons.doc_text,
        label: '作业',
        badge: controller.pendingCount,
      ),
      _NavItem(
        section: _ShellSection.schedule,
        icon: CupertinoIcons.calendar,
        label: '课程',
      ),
      _NavItem(
        section: _ShellSection.notices,
        icon: CupertinoIcons.bell,
        label: '通知',
        badge: controller.unreadNoticeCount,
      ),
      _NavItem(
        section: _ShellSection.messages,
        icon: CupertinoIcons.chat_bubble_2,
        label: '私信',
        badge: controller.unreadPrivateMessageCount,
      ),
    ];

    return AppPanel(
      frosted: true,
      padding: const EdgeInsets.fromLTRB(10, 12, 10, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              const AppMark(size: 36),
              if (expanded) ...<Widget>[
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      const Text(
                        '班学帮 Student',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF111827),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        formatClassBadge(summary, dashboard),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF6B7280),
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 14),
          Container(
            padding: EdgeInsets.symmetric(
              horizontal: expanded ? 12 : 8,
              vertical: 10,
            ),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.54),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0x141D1D1F)),
            ),
            child: expanded
                ? Row(
                    children: <Widget>[
                      Container(
                        width: 30,
                        height: 30,
                        decoration: BoxDecoration(
                          color: const Color(0xFFE8EEF9),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          (summary.user?.name.isNotEmpty == true)
                              ? summary.user!.name.characters.first
                              : 'B',
                          style: const TextStyle(
                            color: Color(0xFF1D4ED8),
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              summary.user?.name ?? '未登录',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              summary.currentSubject?.name.isNotEmpty == true
                                  ? summary.currentSubject!.name
                                  : '当前未选科目',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFF6B7280),
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  )
                : const Icon(CupertinoIcons.person_crop_circle, size: 20),
          ),
          const SizedBox(height: 14),
          if (expanded)
            const Padding(
              padding: EdgeInsets.fromLTRB(6, 0, 6, 8),
              child: Text(
                '导航',
                style: TextStyle(
                  color: Color(0xFF6B7280),
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          for (final item in items)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: _SidebarItem(
                expanded: expanded,
                icon: item.icon,
                label: item.label,
                badge: item.badge,
                selected: item.section == section,
                onTap: () => onSectionSelected(item.section),
              ),
            ),
          const Spacer(),
          Container(
            padding: EdgeInsets.symmetric(
              horizontal: expanded ? 12 : 8,
              vertical: 12,
            ),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.48),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0x121D1D1F)),
            ),
            child: expanded
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        '${controller.riskCount}',
                        style: Theme.of(context).textTheme.headlineSmall
                            ?.copyWith(
                              fontWeight: FontWeight.w900,
                              color: const Color(0xFFBE123C),
                            ),
                      ),
                      const SizedBox(height: 2),
                      const Text(
                        '风险作业',
                        style: TextStyle(
                          color: Color(0xFF4B5563),
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        formatSessionTimestamp(summary),
                        style: const TextStyle(
                          color: Color(0xFF6B7280),
                          fontSize: 12,
                          height: 1.35,
                        ),
                      ),
                    ],
                  )
                : Text(
                    '${controller.riskCount}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      color: Color(0xFFBE123C),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _Toolbar extends StatelessWidget {
  const _Toolbar({
    required this.controller,
    required this.title,
    required this.subtitle,
    required this.currentTermId,
  });

  final AppController controller;
  final String title;
  final String subtitle;
  final String? currentTermId;

  @override
  Widget build(BuildContext context) {
    final dashboard = controller.dashboard!;
    final summary = dashboard.session;
    final currentSubject = summary.currentSubject;
    final subjects = summary.availableSubjects;
    final terms = dashboard.terms.isNotEmpty
        ? dashboard.terms
        : summary.availableTerms;
    final meta = <String>[
      formatClassBadge(summary, dashboard),
      if (currentSubject?.name.isNotEmpty == true) currentSubject!.name,
      if ((dashboard.gpa?.averageLevel ?? '').isNotEmpty)
        'GPA ${dashboard.gpa!.averageLevel}',
      if (controller.unreadNoticeCount > 0)
        '${controller.unreadNoticeCount} 未读',
    ].join(' · ');

    return AppPanel(
      frosted: true,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final compact = constraints.maxWidth < 1180;
          final controls = Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            alignment: WrapAlignment.end,
            children: <Widget>[
              _ToolbarSelect(
                width: 220,
                icon: CupertinoIcons.book,
                value: currentSubject?.id,
                placeholder: '科目',
                items: subjects
                    .map((subject) => _SelectItem(subject.id, subject.name))
                    .toList(),
                enabled: !controller.changingSubject,
                onChanged: (value) {
                  final selected = subjects
                      .where((item) => item.id == value)
                      .firstOrNull;
                  if (selected != null) {
                    controller.setCurrentSubject(selected);
                  }
                },
              ),
              _ToolbarSelect(
                width: 220,
                icon: CupertinoIcons.calendar,
                value: currentTermId,
                placeholder: '学期',
                items: terms
                    .map((term) => _SelectItem(term.id, term.name))
                    .toList(),
                enabled: !controller.changingTerm,
                onChanged: (value) {
                  if (value != null) {
                    controller.setCurrentTerm(value);
                  }
                },
              ),
              _ToolbarCounter(
                icon: CupertinoIcons.bell,
                label: controller.unreadNoticeCount > 0
                    ? '${controller.unreadNoticeCount} 未读'
                    : '通知',
              ),
              _ToolbarIconButton(
                tooltip: '刷新数据',
                icon: controller.refreshing
                    ? CupertinoIcons.arrow_clockwise_circle
                    : CupertinoIcons.refresh,
                onPressed: controller.refreshing
                    ? null
                    : controller.refreshDashboard,
              ),
              _ToolbarIconButton(
                tooltip: '退出登录',
                icon: CupertinoIcons.square_arrow_left,
                onPressed: controller.authenticating ? null : controller.logout,
              ),
            ],
          );

          if (compact) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                _ToolbarHeading(title: title, subtitle: subtitle, meta: meta),
                const SizedBox(height: 12),
                controls,
              ],
            );
          }

          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              Expanded(
                child: _ToolbarHeading(
                  title: title,
                  subtitle: subtitle,
                  meta: meta,
                ),
              ),
              const SizedBox(width: 12),
              Flexible(child: controls),
            ],
          );
        },
      ),
    );
  }
}

class _ToolbarHeading extends StatelessWidget {
  const _ToolbarHeading({
    required this.title,
    required this.subtitle,
    required this.meta,
  });

  final String title;
  final String subtitle;
  final String meta;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          title,
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.w900,
            height: 1.05,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: const TextStyle(color: Color(0xFF6B7280), height: 1.35),
        ),
        if (meta.isNotEmpty) ...<Widget>[
          const SizedBox(height: 6),
          Text(
            meta,
            style: const TextStyle(
              color: Color(0xFF4B5563),
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ],
    );
  }
}

class _ToolbarSelect extends StatelessWidget {
  const _ToolbarSelect({
    required this.width,
    required this.icon,
    required this.placeholder,
    required this.items,
    required this.enabled,
    required this.onChanged,
    this.value,
  });

  final double width;
  final IconData icon;
  final String placeholder;
  final List<_SelectItem> items;
  final String? value;
  final bool enabled;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    final hasValue = items.any((item) => item.value == value);
    return Container(
      width: width,
      height: 38,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.58),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0x1A1D1D1F)),
      ),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 16, color: const Color(0xFF4B5563)),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                isExpanded: true,
                value: hasValue ? value : null,
                hint: Text(
                  placeholder,
                  style: const TextStyle(
                    color: Color(0xFF6B7280),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                icon: const Icon(CupertinoIcons.chevron_down, size: 14),
                dropdownColor: Colors.white,
                borderRadius: BorderRadius.circular(8),
                style: const TextStyle(
                  color: Color(0xFF111827),
                  fontWeight: FontWeight.w700,
                ),
                onChanged: enabled ? onChanged : null,
                items: items
                    .map(
                      (item) => DropdownMenuItem<String>(
                        value: item.value,
                        child: Text(
                          item.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                    .toList(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ToolbarCounter extends StatelessWidget {
  const _ToolbarCounter({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 38,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.54),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0x141D1D1F)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 15, color: const Color(0xFF4B5563)),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              color: Color(0xFF111827),
            ),
          ),
        ],
      ),
    );
  }
}

class _ToolbarIconButton extends StatelessWidget {
  const _ToolbarIconButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: SizedBox(
        width: 38,
        height: 38,
        child: OutlinedButton(
          onPressed: onPressed,
          style: OutlinedButton.styleFrom(
            padding: EdgeInsets.zero,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
            ),
          ),
          child: Icon(icon, size: 18),
        ),
      ),
    );
  }
}

class _SidebarItem extends StatefulWidget {
  const _SidebarItem({
    required this.expanded,
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
    this.badge,
  });

  final bool expanded;
  final IconData icon;
  final String label;
  final int? badge;
  final bool selected;
  final VoidCallback onTap;

  @override
  State<_SidebarItem> createState() => _SidebarItemState();
}

class _SidebarItemState extends State<_SidebarItem> {
  bool _hovering = false;

  @override
  Widget build(BuildContext context) {
    final active = widget.selected || _hovering;
    final badge = widget.badge ?? 0;

    return MouseRegion(
      onEnter: (_) => setState(() => _hovering = true),
      onExit: (_) => setState(() => _hovering = false),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: widget.onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 130),
            padding: EdgeInsets.symmetric(
              horizontal: widget.expanded ? 12 : 10,
              vertical: 10,
            ),
            decoration: BoxDecoration(
              color: widget.selected
                  ? const Color(0xFFE8EEF9)
                  : active
                  ? Colors.white.withValues(alpha: 0.42)
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: widget.selected
                    ? const Color(0x332563EB)
                    : Colors.transparent,
              ),
            ),
            child: widget.expanded
                ? Row(
                    children: <Widget>[
                      Icon(
                        widget.icon,
                        size: 17,
                        color: widget.selected
                            ? const Color(0xFF1D4ED8)
                            : const Color(0xFF4B5563),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          widget.label,
                          style: TextStyle(
                            color: widget.selected
                                ? const Color(0xFF1D4ED8)
                                : const Color(0xFF111827),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      if (badge > 0) _Badge(value: badge),
                    ],
                  )
                : Center(
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: <Widget>[
                        Icon(
                          widget.icon,
                          size: 18,
                          color: widget.selected
                              ? const Color(0xFF1D4ED8)
                              : const Color(0xFF4B5563),
                        ),
                        if (badge > 0)
                          Positioned(
                            right: -8,
                            top: -8,
                            child: _Badge(value: badge, compact: true),
                          ),
                      ],
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.value, this.compact = false});

  final int value;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(minWidth: compact ? 18 : 22),
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 5 : 6,
        vertical: compact ? 2 : 3,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFF111827),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        '$value',
        textAlign: TextAlign.center,
        style: TextStyle(
          color: Colors.white,
          fontSize: compact ? 10 : 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: AppPanel(
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 18),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              AppMark(size: 28),
              SizedBox(width: 12),
              Text(
                '正在准备班学帮桌面工作台…',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SelectItem {
  const _SelectItem(this.value, this.label);

  final String value;
  final String label;
}

class _NavItem {
  const _NavItem({
    required this.section,
    required this.icon,
    required this.label,
    this.badge,
  });

  final _ShellSection section;
  final IconData icon;
  final String label;
  final int? badge;
}
