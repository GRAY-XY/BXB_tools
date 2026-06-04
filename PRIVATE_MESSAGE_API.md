# 私信功能API文档

## 后端API

已在 `desktop-shell/node_bridge.js` 中实现了三个私信相关的命令：

### 1. 获取私信联系人列表

```bash
node desktop-shell/node_bridge.js list-private-contacts '{}'
```

**返回数据示例：**
```json
{
  "ok": true,
  "data": {
    "contacts": [
      {
        "id": "2059089884746555394",
        "classId": "86db67752afe4bdca48c36e03512cbb4",
        "className": "2026-M1 AP Cybersecurity",
        "peerId": "4e7baac396c342eb8e299b7d0db2edbb",
        "peerName": "佟佳宁",
        "peerType": "T",
        "unreadNum": 0,
        "lastTime": "1780565757000",
        "lastContent": "就你前面给我说的那个",
        "courseName": "AP网络安全",
        "courseColor": "#208FE9"
      }
    ],
    "count": 3
  }
}
```

### 2. 获取私信会话内容

```bash
node desktop-shell/node_bridge.js get-private-thread '{
  "contact": {...},
  "size": 20,
  "endTime": ""
}'
```

**参数说明：**
- `contact`: 从 list-private-contacts 返回的联系人对象
- `size`: 每页消息数量，默认20
- `endTime`: 用于分页的时间戳，为空则获取最新消息

**返回数据示例：**
```json
{
  "ok": true,
  "data": {
    "messages": [
      {
        "id": "...",
        "content": "消息内容",
        "senderId": "...",
        "senderName": "发送者",
        "receiverId": "...",
        "receiverName": "接收者",
        "createTime": "2026-05-27 10:30:00",
        "contentType": "T",
        "readFlag": 1
      }
    ],
    "hasMore": false,
    "count": 15
  }
}
```

### 3. 发送私信

```bash
node desktop-shell/node_bridge.js send-private-message '{
  "contact": {...},
  "content": "消息内容"
}'
```

**参数说明：**
- `contact`: 从 list-private-contacts 返回的联系人对象
- `content`: 要发送的文字消息内容

**返回数据示例：**
```json
{
  "ok": true,
  "data": {
    "sent": true,
    "message": {
      "id": "...",
      "content": "消息内容",
      "senderId": "...",
      "createTime": "2026-06-04 17:30:00"
    }
  }
}
```

## Flutter模型

已在 `UI/banxuebang_flutter/lib/src/models/models.dart` 中添加了两个模型：

### PrivateContact
```dart
class PrivateContact {
  final String id;
  final String classId;
  final String className;
  final String peerId;
  final String peerName;
  final String peerType;  // "T"=老师, "S"=学生
  final int unreadNum;
  final String lastTime;
  final String lastContent;
  final String? peerAvatar;
  final int? peerSexCode;
  final String? courseName;
  final String? courseColor;
  final JsonMap? raw;  // 原始数据，用于传给后端API
}
```

### PrivateMessage
```dart
class PrivateMessage {
  final String id;
  final String content;
  final String senderId;
  final String senderName;
  final String receiverId;
  final String receiverName;
  final String createTime;
  final String? contentType;  // "T"=文字
  final int? readFlag;  // 0=未读, 1=已读
  final String? senderType;
  final String? receiverType;
}
```

## 前端TODO

要完成私信功能的前端实现，还需要：

### 1. 创建私信页面
创建 `UI/banxuebang_flutter/lib/src/screens/messages_page.dart`

页面结构建议：
- 左侧：联系人列表 (_ContactListPanel)
  - 显示老师头像、姓名、课程、最后消息预览
  - 显示未读消息数量
  - 点击选中联系人
- 右侧：消息会话 (_MessageThreadPanel)
  - 显示消息列表（时间倒序）
  - 区分发送和接收的消息
  - 底部输入框和发送按钮

### 2. 更新AppController
在 `UI/banxuebang_flutter/lib/src/state/app_controller.dart` 中添加：

```dart
// 状态
List<PrivateContact> _privateContacts = [];
PrivateContact? _selectedContact;
List<PrivateMessage> _messages = [];
bool _loadingContacts = false;
bool _loadingMessages = false;
bool _sendingMessage = false;

// 方法
Future<void> loadPrivateContacts()
Future<void> loadMessageThread(PrivateContact contact)
Future<void> sendMessage(PrivateContact contact, String content)
int get unreadPrivateMessageCount  // 所有联系人的未读总数
```

### 3. 添加私信入口
在 `UI/banxuebang_flutter/lib/src/app.dart` 的导航栏中添加"私信"标签：

```dart
enum _ShellSection { overview, homework, schedule, notices, messages }

_NavItem(
  section: _ShellSection.messages,
  icon: CupertinoIcons.chat_bubble_2,
  label: '私信',
  badge: controller.unreadPrivateMessageCount,
),
```

### 4. 测试建议

1. 先在终端测试后端API确保数据正确
2. 实现联系人列表显示
3. 实现点击联系人加载消息
4. 最后实现发送消息功能

## 注意事项

1. **权限**: 发送消息需要用户主动点击，不能自动发送
2. **分页**: 消息列表支持分页，使用 `endTime` 参数加载更早的消息
3. **实时性**: 当前实现需要手动刷新，未来可考虑轮询或WebSocket
4. **错误处理**: 网络错误、权限错误等需要友好提示

## 示例使用流程

```dart
// 1. 加载联系人列表
await controller.loadPrivateContacts();

// 2. 用户点击某个联系人
await controller.loadMessageThread(selectedContact);

// 3. 用户输入并发送消息
await controller.sendMessage(selectedContact, "你好，老师！");

// 4. 重新加载消息列表看到新消息
await controller.loadMessageThread(selectedContact);
```

## 已完成

✅ 后端API实现（node_bridge.js）
✅ Flutter数据模型（models.dart）
✅ 后端API测试通过
✅ 代码已推送到GitHub的client分支

## 待完成

⬜ 创建messages_page.dart私信页面
⬜ 更新AppController添加私信相关状态和方法
⬜ 在导航栏添加私信入口
⬜ 实现消息发送和接收UI
⬜ 添加未读消息提示
