import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../models/models.dart';
import '../state/app_controller.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';

class MessagesPage extends StatefulWidget {
  const MessagesPage({super.key, required this.controller});

  final AppController controller;

  @override
  State<MessagesPage> createState() => _MessagesPageState();
}

class _MessagesPageState extends State<MessagesPage> {
  String? _selectedContactId;
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _messageScrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _loadContacts();
  }

  @override
  void dispose() {
    _messageController.dispose();
    _messageScrollController.dispose();
    super.dispose();
  }

  Future<void> _loadContacts() async {
    await widget.controller.loadPrivateContacts();
    if (mounted && widget.controller.privateContacts.isNotEmpty) {
      _selectContact(widget.controller.privateContacts.first);
    }
  }

  void _selectContact(PrivateContact contact) {
    setState(() => _selectedContactId = contact.id);
    widget.controller.loadMessageThread(contact);
  }

  Future<void> _sendMessage() async {
    final contact = widget.controller.privateContacts
        .where((c) => c.id == _selectedContactId)
        .firstOrNull;
    if (contact == null) return;

    final content = _messageController.text.trim();
    if (content.isEmpty) return;

    _messageController.clear();
    await widget.controller.sendPrivateMessage(contact, content);
    
    // 滚动到底部显示新消息
    if (_messageScrollController.hasClients) {
      _messageScrollController.animateTo(
        _messageScrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final contacts = widget.controller.privateContacts;
    final selectedContact = contacts
        .where((c) => c.id == _selectedContactId)
        .firstOrNull;

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final wide = constraints.maxWidth >= 1180;

        final contactListPanel = _ContactListPanel(
          controller: widget.controller,
          contacts: contacts,
          selectedContactId: _selectedContactId,
          onSelected: _selectContact,
          onRefresh: _loadContacts,
        );

        final messagePanel = _MessagePanel(
          controller: widget.controller,
          contact: selectedContact,
          messageController: _messageController,
          scrollController: _messageScrollController,
          onSend: _sendMessage,
        );

        if (wide) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              SizedBox(width: 360, child: contactListPanel),
              const SizedBox(width: 16),
              Expanded(child: messagePanel),
            ],
          );
        }

        return Column(
          children: <Widget>[
            SizedBox(height: 280, child: contactListPanel),
            const SizedBox(height: 16),
            Expanded(child: messagePanel),
          ],
        );
      },
    );
  }
}

class _ContactListPanel extends StatelessWidget {
  const _ContactListPanel({
    required this.controller,
    required this.contacts,
    required this.selectedContactId,
    required this.onSelected,
    required this.onRefresh,
  });

  final AppController controller;
  final List<PrivateContact> contacts;
  final String? selectedContactId;
  final ValueChanged<PrivateContact> onSelected;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return AppPanel(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      '私信',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 4),
                    Text(
                      '与老师的私信会话',
                      style: TextStyle(
                        color: Color(0xFF6B7B91),
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(CupertinoIcons.refresh, size: 20),
                onPressed: controller.loadingPrivateContacts ? null : onRefresh,
                tooltip: '刷新',
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (controller.loadingPrivateContacts)
            const Expanded(
              child: Center(
                child: CircularProgressIndicator(strokeWidth: 2.5),
              ),
            )
          else if (contacts.isEmpty)
            const Expanded(
              child: Center(
                child: Text(
                  '暂无私信联系人',
                  style: TextStyle(
                    color: Color(0xFF6B7B91),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            )
          else
            Expanded(
              child: ListView.separated(
                itemCount: contacts.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (BuildContext context, int index) {
                  final contact = contacts[index];
                  final selected = contact.id == selectedContactId;
                  final accentColor = colorFromHex(
                    contact.courseColor,
                    fallback: const Color(0xFF2563EB),
                  );

                  return Material(
                    color: Colors.transparent,
                    child: InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: () => onSelected(contact),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 150),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: selected
                              ? accentColor.withValues(alpha: 0.12)
                              : const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: selected
                                ? accentColor.withValues(alpha: 0.25)
                                : const Color(0xFFD8DEE7),
                          ),
                        ),
                        child: Row(
                          children: <Widget>[
                            Container(
                              width: 48,
                              height: 48,
                              decoration: BoxDecoration(
                                color: accentColor.withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(24),
                              ),
                              alignment: Alignment.center,
                              child: Icon(
                                contact.peerType == 'T'
                                    ? CupertinoIcons.person
                                    : CupertinoIcons.person_2,
                                color: accentColor,
                                size: 24,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: <Widget>[
                                  Row(
                                    children: <Widget>[
                                      Expanded(
                                        child: Text(
                                          contact.peerName,
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w800,
                                            fontSize: 15,
                                          ),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      if (contact.unreadNum > 0)
                                        Container(
                                          constraints: const BoxConstraints(minWidth: 20),
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 6,
                                            vertical: 2,
                                          ),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFEF4444),
                                            borderRadius: BorderRadius.circular(10),
                                          ),
                                          child: Text(
                                            '${contact.unreadNum}',
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 11,
                                              fontWeight: FontWeight.w800,
                                            ),
                                            textAlign: TextAlign.center,
                                          ),
                                        ),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  if (contact.courseName?.isNotEmpty ?? false)
                                    Text(
                                      contact.courseName!,
                                      style: TextStyle(
                                        color: accentColor,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w700,
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  const SizedBox(height: 4),
                                  Text(
                                    contact.lastContent.isNotEmpty
                                        ? contact.lastContent
                                        : '暂无消息',
                                    style: const TextStyle(
                                      color: Color(0xFF6B7B91),
                                      fontSize: 13,
                                    ),
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ],
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

class _MessagePanel extends StatelessWidget {
  const _MessagePanel({
    required this.controller,
    required this.contact,
    required this.messageController,
    required this.scrollController,
    required this.onSend,
  });

  final AppController controller;
  final PrivateContact? contact;
  final TextEditingController messageController;
  final ScrollController scrollController;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    if (contact == null) {
      return const AppPanel(
        padding: EdgeInsets.all(18),
        child: Center(
          child: Text(
            '选择一个联系人开始对话',
            style: TextStyle(
              color: Color(0xFF6B7B91),
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      );
    }

    final messages = controller.privateMessages;
    final currentUserId = controller.dashboard?.session.user?.id ?? '';

    return AppPanel(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: colorFromHex(
                    contact!.courseColor,
                    fallback: const Color(0xFF2563EB),
                  ).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(20),
                ),
                alignment: Alignment.center,
                child: Icon(
                  contact!.peerType == 'T'
                      ? CupertinoIcons.person
                      : CupertinoIcons.person_2,
                  color: colorFromHex(
                    contact!.courseColor,
                    fallback: const Color(0xFF2563EB),
                  ),
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      contact!.peerName,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    if (contact!.courseName?.isNotEmpty ?? false)
                      Text(
                        contact!.courseName!,
                        style: TextStyle(
                          color: colorFromHex(
                            contact!.courseColor,
                            fallback: const Color(0xFF2563EB),
                          ),
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                  ],
                ),
              ),
              if (controller.loadingPrivateMessages)
                const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
          const SizedBox(height: 16),
          const Divider(height: 1),
          const SizedBox(height: 16),
          Expanded(
            child: messages.isEmpty
                ? const Center(
                    child: Text(
                      '暂无消息记录',
                      style: TextStyle(
                        color: Color(0xFF6B7B91),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  )
                : ListView.separated(
                    controller: scrollController,
                    itemCount: messages.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (BuildContext context, int index) {
                      final message = messages[index];
                      final isSentByMe = message.senderId == currentUserId;

                      return _MessageBubble(
                        message: message,
                        isSentByMe: isSentByMe,
                        accentColor: colorFromHex(
                          contact!.courseColor,
                          fallback: const Color(0xFF2563EB),
                        ),
                      );
                    },
                  ),
          ),
          const SizedBox(height: 16),
          const Divider(height: 1),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Expanded(
                child: TextField(
                  controller: messageController,
                  maxLines: 3,
                  minLines: 1,
                  decoration: const InputDecoration(
                    hintText: '输入消息内容...',
                    border: OutlineInputBorder(),
                  ),
                  enabled: !controller.sendingPrivateMessage,
                ),
              ),
              const SizedBox(width: 12),
              FilledButton.icon(
                onPressed: controller.sendingPrivateMessage ? null : onSend,
                icon: Icon(
                  controller.sendingPrivateMessage
                      ? CupertinoIcons.hourglass
                      : CupertinoIcons.paperplane,
                ),
                label: Text(controller.sendingPrivateMessage ? '发送中' : '发送'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.message,
    required this.isSentByMe,
    required this.accentColor,
  });

  final PrivateMessage message;
  final bool isSentByMe;
  final Color accentColor;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: isSentByMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.7,
        ),
        child: Column(
          crossAxisAlignment:
              isSentByMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (!isSentByMe) ...<Widget>[
                  Text(
                    message.senderName,
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xFF6B7B91),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                Text(
                  formatShortDateTime(message.createTime),
                  style: const TextStyle(
                    fontSize: 11,
                    color: Color(0xFF9CA3AF),
                  ),
                ),
                if (isSentByMe) ...<Widget>[
                  const SizedBox(width: 8),
                  Text(
                    message.senderName,
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xFF6B7B91),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: isSentByMe
                    ? accentColor.withValues(alpha: 0.15)
                    : const Color(0xFFF3F4F6),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isSentByMe
                      ? accentColor.withValues(alpha: 0.3)
                      : const Color(0xFFE5E7EB),
                ),
              ),
              child: SelectableText(
                message.content,
                style: TextStyle(
                  color: isSentByMe ? accentColor : const Color(0xFF1F2937),
                  fontSize: 14,
                  height: 1.5,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
