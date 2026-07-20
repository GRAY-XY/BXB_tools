# 私信API参考文档

本文档提供私信功能相关的API快速参考。

## Flutter API (Dart)

### AppController 方法

#### ensurePrivateMessagesLoaded()
确保私信数据已加载（懒加载模式）。

```dart
Future<void> ensurePrivateMessagesLoaded()
```

**用途**: 在进入私信页面时调用，只在首次访问时加载数据。

**示例**:
```dart
@override
void initState() {
  super.initState();
  widget.controller.ensurePrivateMessagesLoaded();
}
```

---

#### loadPrivateContacts()
加载私信联系人列表。

```dart
Future<void> loadPrivateContacts()
```

**返回**: 无（通过 `notifyListeners()` 更新UI）

**状态更新**:
- `loadingPrivateContacts`: 加载过程中为 `true`
- `privateContacts`: 更新为联系人列表
- `bannerMessage`: 如果出错，显示错误信息

**示例**:
```dart
await controller.loadPrivateContacts();
```

---

#### loadMessageThread()
加载与指定联系人的消息会话。

```dart
Future<void> loadMessageThread(PrivateContact contact)
```

**参数**:
- `contact`: 要查看消息的联系人对象

**返回**: 无（通过 `notifyListeners()` 更新UI）

**状态更新**:
- `selectedPrivateContact`: 设置为当前联系人
- `loadingPrivateMessages`: 加载过程中为 `true`
- `privateMessages`: 更新为消息列表
- `privateContacts`: 清除该联系人的未读数

**示例**:
```dart
final contact = controller.privateContacts.first;
await controller.loadMessageThread(contact);
```

---

#### sendPrivateMessage()
发送私信消息。

```dart
Future<void> sendPrivateMessage(
  PrivateContact contact,
  String content,
)
```

**参数**:
- `contact`: 接收消息的联系人
- `content`: 消息内容（纯文本）

**返回**: 无（通过 `notifyListeners()` 更新UI）

**验证**:
- 内容不能为空（trim后）
- 如果为空，设置错误横幅

**状态更新**:
- `sendingPrivateMessage`: 发送过程中为 `true`
- `privateMessages`: 添加新发送的消息
- `privateContacts`: 更新联系人的最后消息和时间
- `bannerMessage`: 成功或失败提示

**示例**:
```dart
final contact = controller.selectedPrivateContact;
if (contact != null) {
  await controller.sendPrivateMessage(contact, '你好，老师！');
}
```

---

### AppController 属性

#### privateContacts
```dart
List<PrivateContact> get privateContacts
```
当前加载的私信联系人列表。

---

#### selectedPrivateContact
```dart
PrivateContact? get selectedPrivateContact
```
当前选中的联系人（正在查看其消息）。

---

#### privateMessages
```dart
List<PrivateMessage> get privateMessages
```
当前选中联系人的消息列表。

---

#### loadingPrivateContacts
```dart
bool get loadingPrivateContacts
```
是否正在加载联系人列表。

---

#### loadingPrivateMessages
```dart
bool get loadingPrivateMessages
```
是否正在加载消息列表。

---

#### sendingPrivateMessage
```dart
bool get sendingPrivateMessage
```
是否正在发送消息。

---

#### unreadPrivateMessageCount
```dart
int get unreadPrivateMessageCount
```
所有联系人的未读消息总数（用于显示徽章）。

**计算方式**:
```dart
privateContacts.fold<int>(
  0,
  (sum, contact) => sum + contact.unreadNum,
)
```

---

## Bridge API (Dart)

### DesktopBridge 方法

#### listPrivateContacts()
```dart
Future<List<PrivateContact>> listPrivateContacts()
```

**调用后端**: `list-private-contacts` 命令

**返回**: 联系人列表

**异常**: 
- `StateError`: 如果后端返回错误或会话无效

---

#### getPrivateMessageThread()
```dart
Future<List<PrivateMessage>> getPrivateMessageThread(
  PrivateContact contact,
)
```

**参数**:
- `contact`: 联系人对象（必须包含 `raw` 字段）

**调用后端**: `get-private-thread` 命令

**返回**: 消息列表（最多50条）

**异常**: 
- `StateError`: 如果后端返回错误或联系人无效

---

#### sendPrivateMessage()
```dart
Future<PrivateMessage> sendPrivateMessage(
  PrivateContact contact,
  String content,
)
```

**参数**:
- `contact`: 接收者联系人对象
- `content`: 消息内容

**调用后端**: `send-private-message` 命令

**返回**: 发送成功的消息对象

**异常**: 
- `StateError`: 如果发送失败或返回数据无效

---

## Node.js Bridge API

### 命令: list-private-contacts

**输入**:
```json
{}
```

**输出**:
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

---

### 命令: get-private-thread

**输入**:
```json
{
  "contact": {
    "classId": "...",
    "receiverId": "...",
    "senderId": "...",
    "receiverType": "T",
    "senderType": "S"
  },
  "size": 50,
  "endTime": ""
}
```

**参数说明**:
- `contact`: 联系人的原始数据对象
- `size`: 每页消息数量（默认20，前端使用50）
- `endTime`: 用于分页的结束时间（空字符串表示最新消息）

**输出**:
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

---

### 命令: send-private-message

**输入**:
```json
{
  "contact": {
    "classId": "...",
    "receiverId": "...",
    "senderId": "...",
    "receiverType": "T",
    "senderType": "S"
  },
  "content": "消息内容"
}
```

**输出**:
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

**错误响应**:
```json
{
  "ok": false,
  "error": "错误描述信息"
}
```

---

## BanxuebangClient API (JavaScript)

### listPrivateMessageContacts()

```javascript
async listPrivateMessageContacts()
```

**返回**:
```javascript
{
  contacts: PrivateContact[],
  count: number
}
```

**HTTP请求**:
```
GET /gateway/bxb/priv-msg/user/{userId}/contact-list?userType=S
```

---

### getPrivateMessageThread()

```javascript
async getPrivateMessageThread(contact, { size = 20, endTime = "" } = {})
```

**参数**:
- `contact`: 联系人对象或原始数据
- `options.size`: 消息数量（默认20）
- `options.endTime`: 分页结束时间（默认空）

**返回**:
```javascript
{
  contact: PrivateContact,
  messages: PrivateMessage[],
  page: {
    totalPages: number,
    number: number,
    size: number,
    hasContent: boolean,
    totalRecords: number
  }
}
```

**HTTP请求**:
```
GET /gateway/bxb/priv-msg-content/class/{classId}/page-query
  ?size=20
  &classId=...
  &receiverId=...
  &senderId=...
  &receiverType=T
  &senderType=S
```

---

### sendPrivateMessageText()

```javascript
async sendPrivateMessageText(contact, content)
```

**参数**:
- `contact`: 联系人对象
- `content`: 消息内容（字符串）

**返回**:
```javascript
{
  sent: true,
  message: PrivateMessage
}
```

**HTTP请求**:
```
POST /gateway/bxb/priv-msg-content/send
Content-Type: application/json

{
  "kinship": "",
  "childId": "",
  "receiverType": "T",
  "receiverId": "...",
  "senderId": "...",
  "senderType": "S",
  "classId": "...",
  "content": "消息内容",
  "contentType": "T"
}
```

---

## 数据类型

### PrivateContact (Dart)

```dart
class PrivateContact {
  final String id;
  final String classId;
  final String className;
  final String peerId;
  final String peerName;
  final String peerType;      // "T" | "S"
  final int unreadNum;
  final String lastTime;
  final String lastContent;
  final String? peerAvatar;
  final int? peerSexCode;
  final String? courseName;
  final String? courseColor;  // HEX color string
  final JsonMap? raw;         // 原始API数据
  
  PrivateContact.fromJson(JsonMap json);
}
```

---

### PrivateMessage (Dart)

```dart
class PrivateMessage {
  final String id;
  final String content;
  final String senderId;
  final String senderName;
  final String receiverId;
  final String receiverName;
  final String createTime;    // "yyyy-MM-dd HH:mm:ss"
  final String? contentType;  // "T" (文字)
  final int? readFlag;        // 0=未读, 1=已读
  final String? senderType;
  final String? receiverType;
  
  PrivateMessage.fromJson(JsonMap json);
}
```

---

## 错误码

### 客户端错误
- `StateError`: 一般性状态错误（网络、认证、验证等）
  - 通过 `error.message` 获取详细信息

### HTTP状态码
- `200`: 成功
- `400`: 请求参数错误
- `401`: 未授权（会话过期）
- `403`: 无权限
- `500`: 服务器错误

### 业务错误码
在响应的 `code` 字段中返回：
- `200`: 成功
- 其他: 业务错误（具体含义见API服务器文档）

---

## 使用示例

### 完整流程示例

```dart
// 1. 进入私信页面时加载联系人
await controller.ensurePrivateMessagesLoaded();

// 2. 获取联系人列表
final contacts = controller.privateContacts;
if (contacts.isEmpty) {
  print('没有联系人');
  return;
}

// 3. 选择第一个联系人
final contact = contacts.first;
print('选中联系人: ${contact.peerName}');

// 4. 加载消息会话
await controller.loadMessageThread(contact);

// 5. 获取消息列表
final messages = controller.privateMessages;
print('消息数量: ${messages.length}');

// 6. 发送消息
await controller.sendPrivateMessage(contact, '你好，老师！');

// 7. 再次加载消息（查看新发送的消息）
await controller.loadMessageThread(contact);
```

### 错误处理示例

```dart
try {
  await controller.loadPrivateContacts();
} catch (e) {
  // 错误已经通过 bannerMessage 显示
  // 也可以在这里做额外处理
  print('加载失败: $e');
}
```

---

## 调试技巧

### 1. 查看原始数据
```dart
final contact = controller.privateContacts.first;
print('原始数据: ${contact.raw}');
```

### 2. 检查加载状态
```dart
print('正在加载联系人: ${controller.loadingPrivateContacts}');
print('正在加载消息: ${controller.loadingPrivateMessages}');
print('正在发送消息: ${controller.sendingPrivateMessage}');
```

### 3. 检查未读消息
```dart
print('总未读数: ${controller.unreadPrivateMessageCount}');
for (final contact in controller.privateContacts) {
  print('${contact.peerName}: ${contact.unreadNum} 条未读');
}
```

### 4. Node.js Bridge调试
```bash
# 使用MCP CLI直接测试
node scripts/call-tool.js list-private-contacts '{}'

# 或使用direct工具（绕过MCP）
node scripts/direct-tool.js list-private-contacts '{}'
```

---

**版本**: 1.0  
**最后更新**: 2026-06-12
