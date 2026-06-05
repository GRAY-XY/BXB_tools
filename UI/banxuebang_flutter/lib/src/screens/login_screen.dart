import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../state/app_controller.dart';
import '../theme/app_theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _usernameController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final busy = controller.authenticating || controller.booting;

    return Scaffold(
      body: DecoratedBox(
        decoration: BoxDecoration(
          color: Theme.of(context).scaffoldBackgroundColor,
        ),
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1240),
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: LayoutBuilder(
                  builder: (BuildContext context, BoxConstraints constraints) {
                    final compact = constraints.maxWidth < 980;
                    final formPanel = _LoginForm(
                      controller: controller,
                      usernameController: _usernameController,
                      passwordController: _passwordController,
                      busy: busy,
                    );
                    final intro = _LoginIntro(
                      controller: controller,
                      compact: compact,
                    );

                    if (compact) {
                      return ListView(
                        children: <Widget>[
                          intro,
                          const SizedBox(height: 18),
                          formPanel,
                        ],
                      );
                    }

                    return Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        Expanded(child: intro),
                        const SizedBox(width: 18),
                        SizedBox(width: 430, child: formPanel),
                      ],
                    );
                  },
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _LoginIntro extends StatelessWidget {
  const _LoginIntro({required this.controller, required this.compact});

  final AppController controller;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const SizedBox(height: 6),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            color: const Color(0xFFDCE9FF),
            borderRadius: BorderRadius.circular(99),
          ),
          child: const Text(
            'macOS Student Desk',
            style: TextStyle(
              color: Color(0xFF1D4ED8),
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        const SizedBox(height: 18),
        Text(
          '班学帮桌面端',
          style: Theme.of(context).textTheme.displaySmall?.copyWith(
            fontWeight: FontWeight.w900,
            height: 1.02,
          ),
        ),
        const SizedBox(height: 12),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 700),
          child: Text(
            '把登录、课表、作业、通知和成绩上下文收进一套更像桌面软件的工作界面里。账号密码能直接登，原有浏览器流程也保留。',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              color: const Color(0xFF516176),
              height: 1.45,
            ),
          ),
        ),
        const SizedBox(height: 22),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: const <Widget>[
            _FactPill(icon: CupertinoIcons.sparkles, label: '学期和科目上下文'),
            _FactPill(icon: CupertinoIcons.doc_text, label: '作业详情与提交'),
            _FactPill(icon: CupertinoIcons.calendar, label: '课程时间轴'),
            _FactPill(icon: CupertinoIcons.bell, label: '通知与未读提醒'),
          ],
        ),
        const SizedBox(height: 22),
        if (compact)
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                children: <Widget>[
                  SizedBox(
                    height: 400,
                    child: _PreviewPanel(controller: controller),
                  ),
                  const SizedBox(height: 18),
                  SizedBox(
                    height: 420,
                    child: _SessionPanel(controller: controller),
                  ),
                ],
              ),
            ),
          )
        else
          Expanded(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(child: _PreviewPanel(controller: controller)),
                const SizedBox(width: 18),
                SizedBox(
                  width: 280,
                  child: _SessionPanel(controller: controller),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _PreviewPanel extends StatelessWidget {
  const _PreviewPanel({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      frosted: true,
      padding: const EdgeInsets.all(18),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Row(
              children: <Widget>[
                const AppMark(size: 42),
                const SizedBox(width: 14),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        '登录后第一屏会直接给你重点',
                        style: TextStyle(fontWeight: FontWeight.w800),
                      ),
                      SizedBox(height: 4),
                      Text(
                        '今天的课、快到期的作业、风险项和最近通知会放在同一层。',
                        style: TextStyle(color: Color(0xFF6B7B91), height: 1.35),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            const _PreviewMetricRow(),
            const SizedBox(height: 12),
            const _PreviewTimeline(),
          ],
        ),
      ),
    );
  }
}

class _SessionPanel extends StatelessWidget {
  const _SessionPanel({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      tint: const Color(0xFFF8FAFC),
      padding: const EdgeInsets.all(18),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Text('本地状态', style: TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            Text(
              controller.session?.sessionFile.isNotEmpty == true
                  ? controller.session!.sessionFile
                  : '当前还没有本地会话文件。',
              style: const TextStyle(color: Color(0xFF6B7B91), height: 1.45),
            ),
            const SizedBox(height: 16),
            const _StatusLine(
              icon: CupertinoIcons.lock_shield,
              title: '账号密码直登',
              detail: '需要时会拉起浏览器完成真实站点流程。',
            ),
            const SizedBox(height: 12),
            const _StatusLine(
              icon: CupertinoIcons.arrow_2_circlepath,
              title: '上下文保持',
              detail: '会话、学期和科目切换都跟着本地状态走。',
            ),
            const SizedBox(height: 12),
            const _StatusLine(
              icon: CupertinoIcons.paperclip,
              title: '作业提交通道',
              detail: '支持备注和附件一起提交，不用再回网页找入口。',
            ),
            const SizedBox(height: 16),
            const Text(
              '浏览器登录适合第一次接入或站点出现额外交互时使用。',
              style: TextStyle(
                color: Color(0xFF6B7B91),
                fontSize: 12,
                height: 1.45,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LoginForm extends StatelessWidget {
  const _LoginForm({
    required this.controller,
    required this.usernameController,
    required this.passwordController,
    required this.busy,
  });

  final AppController controller;
  final TextEditingController usernameController;
  final TextEditingController passwordController;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      frosted: true,
      padding: const EdgeInsets.all(20),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Row(
              children: <Widget>[
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: const Color(0xFFDCE9FF),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  alignment: Alignment.center,
                  child: const Icon(
                    CupertinoIcons.person_crop_circle_badge_checkmark,
                    color: Color(0xFF2563EB),
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        '登录账号',
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        '优先推荐直接输入账号密码；如果站点流程变化，就切回浏览器登录。',
                        style: TextStyle(color: Color(0xFF6B7B91), height: 1.35),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 22),
            TextField(
              controller: usernameController,
              enabled: !busy,
              decoration: const InputDecoration(
                labelText: '账号',
                hintText: '邮箱或账号名',
                prefixIcon: Icon(CupertinoIcons.person),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: passwordController,
              enabled: !busy,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: '密码',
                hintText: '请输入密码',
                prefixIcon: Icon(CupertinoIcons.lock),
              ),
            ),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: busy
                    ? null
                    : () => controller.loginWithCredentials(
                        username: usernameController.text.trim(),
                        password: passwordController.text,
                      ),
                icon: Icon(
                  busy
                      ? CupertinoIcons.hourglass
                      : CupertinoIcons.arrow_right_to_line,
                ),
                label: Text(busy ? '登录中…' : '账号密码登录'),
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: busy ? null : controller.loginInBrowser,
                icon: const Icon(CupertinoIcons.globe),
                label: const Text('浏览器登录'),
              ),
            ),
            const SizedBox(height: 18),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFD8DEE7)),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(
                    CupertinoIcons.info_circle,
                    size: 18,
                    color: Color(0xFF64748B),
                  ),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '如果登录页出现额外验证、勾选项或跳转，浏览器登录会更稳。',
                      style: TextStyle(color: Color(0xFF516176), height: 1.4),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FactPill extends StatelessWidget {
  const _FactPill({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.86),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFD8DEE7)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 16, color: const Color(0xFF2563EB)),
          const SizedBox(width: 8),
          Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

class _PreviewMetricRow extends StatelessWidget {
  const _PreviewMetricRow();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: const <Widget>[
        Expanded(
          child: _PreviewMetricCard(
            label: '今日课程',
            value: '4',
            accent: Color(0xFF2563EB),
          ),
        ),
        SizedBox(width: 12),
        Expanded(
          child: _PreviewMetricCard(
            label: '未读通知',
            value: '1',
            accent: Color(0xFFB45309),
          ),
        ),
        SizedBox(width: 12),
        Expanded(
          child: _PreviewMetricCard(
            label: '平均等级',
            value: 'B',
            accent: Color(0xFF0F9F6E),
          ),
        ),
      ],
    );
  }
}

class _PreviewMetricCard extends StatelessWidget {
  const _PreviewMetricCard({
    required this.label,
    required this.value,
    required this.accent,
  });

  final String label;
  final String value;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: accent.withValues(alpha: 0.16)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            value,
            style: TextStyle(
              color: accent,
              fontSize: 24,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF6B7B91),
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _PreviewTimeline extends StatelessWidget {
  const _PreviewTimeline();

  @override
  Widget build(BuildContext context) {
    const lessons = <({String time, String title, Color color})>[
      (time: '08:00', title: 'AP环境科学', color: Color(0xFF4B7A52)),
      (time: '10:05', title: 'AP统计学', color: Color(0xFF22718E)),
      (time: '14:30', title: '人工智能发展', color: Color(0xFF2563EB)),
    ];

    return AppPanel(
      tint: const Color(0xFFF8FAFC),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('今日预览', style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 18),
          for (final lesson in lessons)
            Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: lesson.color.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: lesson.color.withValues(alpha: 0.18)),
              ),
              child: Row(
                children: <Widget>[
                  SizedBox(
                    width: 68,
                    child: Text(
                      lesson.time,
                      style: const TextStyle(
                        color: Color(0xFF6B7B91),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      lesson.title,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine({
    required this.icon,
    required this.title,
    required this.detail,
  });

  final IconData icon;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: const Color(0xFFDCE9FF),
            borderRadius: BorderRadius.circular(8),
          ),
          alignment: Alignment.center,
          child: Icon(icon, size: 16, color: const Color(0xFF2563EB)),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 3),
              Text(
                detail,
                style: const TextStyle(color: Color(0xFF6B7B91), height: 1.35),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
