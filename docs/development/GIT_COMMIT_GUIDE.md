# Git 提交指南 - 私信功能

## 📝 提交建议

### 提交信息模板

```bash
git add .
git commit -m "feat: 实现私信功能 (v1.1.0)

新增功能：
- 添加私信联系人列表显示
- 实现与老师的消息会话查看
- 支持发送文字消息
- 显示未读消息数量和实时更新
- 集成课程主题色
- 响应式布局适配

技术实现：
- 实现 PrivateContact 和 PrivateMessage 数据模型
- 添加 listPrivateContacts、getPrivateMessageThread、sendPrivateMessage API
- 扩展 AppController 状态管理
- 创建 MessagesPage 及相关UI组件
- 在导航栏添加私信入口

文件变更：
- 新增: UI/banxuebang_flutter/lib/src/screens/messages_page.dart
- 修改: UI/banxuebang_flutter/lib/src/models/models.dart
- 修改: UI/banxuebang_flutter/lib/src/bridge/desktop_bridge.dart
- 修改: UI/banxuebang_flutter/lib/src/state/app_controller.dart
- 修改: UI/banxuebang_flutter/lib/src/app.dart
- 修改: CHANGELOG.md
- 新增: 6个文档文件

测试：
- ✅ Flutter analyze 通过
- ✅ Flutter test 通过
- ⏳ 手动测试待完成

相关文档：
- PRIVATE_MESSAGE_API.md
- 私信功能开发总结.md
- docs/user-guide/私信功能使用指南.md
"
```

---

## 📂 分步提交方案（推荐）

如果你希望更清晰的提交历史，可以分多次提交：

### 步骤 1: 数据模型
```bash
git add UI/banxuebang_flutter/lib/src/models/models.dart
git commit -m "feat(models): 添加私信数据模型

- 新增 PrivateContact 类
- 新增 PrivateMessage 类
- 实现 fromJson 构造函数
- 完整的空值安全处理
"
```

### 步骤 2: 桥接层
```bash
git add UI/banxuebang_flutter/lib/src/bridge/desktop_bridge.dart
git commit -m "feat(bridge): 实现私信API桥接

- 添加 listPrivateContacts() 方法
- 添加 getPrivateMessageThread() 方法
- 添加 sendPrivateMessage() 方法
- 完整的错误处理和类型转换
"
```

### 步骤 3: 状态管理
```bash
git add UI/banxuebang_flutter/lib/src/state/app_controller.dart
git commit -m "feat(state): 扩展状态管理支持私信

- 添加私信相关状态变量
- 实现 loadPrivateContacts() 方法
- 实现 loadMessageThread() 方法
- 实现 sendPrivateMessage() 方法
- 添加 unreadPrivateMessageCount getter
- 实现懒加载机制
"
```

### 步骤 4: UI界面
```bash
git add UI/banxuebang_flutter/lib/src/screens/messages_page.dart
git commit -m "feat(ui): 创建私信页面UI

- 创建 MessagesPage 主页面
- 实现 _ContactListPanel 联系人列表
- 实现 _MessagePanel 消息会话面板
- 实现 _MessageBubble 消息气泡组件
- 响应式布局（宽屏/窄屏自适应）
- 完整的加载状态和错误处理
"
```

### 步骤 5: 导航集成
```bash
git add UI/banxuebang_flutter/lib/src/app.dart
git commit -m "feat(nav): 在导航栏集成私信入口

- 添加 messages 枚举到 _ShellSection
- 添加私信导航项和图标
- 显示未读消息徽章
- 配置页面元数据
"
```

### 步骤 6: 文档更新
```bash
git add CHANGELOG.md PRIVATE_MESSAGE_API.md
git add PRIVATE_MESSAGE_COMPLETION.md
git add 私信功能开发总结.md
git add 私信功能更新说明.md
git add 私信功能发布检查清单.md
git add docs/development/私信功能架构设计.md
git add docs/api/私信API参考.md
git add docs/user-guide/私信功能使用指南.md
git add GIT_COMMIT_GUIDE.md

git commit -m "docs: 添加私信功能完整文档

- 更新 CHANGELOG.md 添加 v1.1.0
- 更新 PRIVATE_MESSAGE_API.md 标记完成
- 新增开发总结文档
- 新增用户使用指南
- 新增架构设计文档
- 新增API参考手册
- 新增发布检查清单
- 新增Git提交指南
"
```

---

## 🏷️ 标签建议

提交完成后，建议创建版本标签：

```bash
# 创建带注释的标签
git tag -a v1.1.0 -m "Release v1.1.0 - 私信功能

主要更新：
- 新增私信功能
- 支持与老师私信沟通
- 显示未读消息提醒
- 响应式UI设计

详细信息请查看 CHANGELOG.md
"

# 推送标签到远程仓库
git push origin v1.1.0
```

---

## 🌿 分支建议

### 开发分支策略

如果项目使用 Git Flow 或类似的分支策略：

```bash
# 1. 从 main/master 创建功能分支
git checkout -b feature/private-messages main

# 2. 在功能分支上进行所有提交
# ... (执行上面的提交步骤)

# 3. 推送功能分支到远程
git push -u origin feature/private-messages

# 4. 创建 Pull Request
# 通过 GitHub/GitLab 界面创建 PR
# 标题: feat: 实现私信功能 (v1.1.0)
# 描述: 参考 私信功能开发总结.md

# 5. 代码审查后合并到 main
# 通过 PR 界面合并，或：
git checkout main
git merge --no-ff feature/private-messages
git push origin main

# 6. 创建版本标签
git tag -a v1.1.0 -m "Release v1.1.0"
git push origin v1.1.0
```

---

## 📋 提交前检查清单

在提交前，请确认：

- [ ] 所有新文件已添加到 Git
- [ ] 没有遗漏的修改
- [ ] 没有调试代码或注释
- [ ] 没有敏感信息（密码、密钥等）
- [ ] .gitignore 正确配置
- [ ] 提交信息清晰准确
- [ ] 相关文档已更新

### 检查命令

```bash
# 查看状态
git status

# 查看未暂存的修改
git diff

# 查看已暂存的修改
git diff --cached

# 查看所有未提交的修改
git diff HEAD

# 查看新增/删除的文件
git status --short
```

---

## 🔍 提交后验证

提交后，验证一切正常：

```bash
# 查看最近的提交
git log --oneline -10

# 查看最后一次提交的详细信息
git show

# 查看提交历史图形化
git log --oneline --graph --decorate --all

# 查看指定文件的提交历史
git log --follow -- UI/banxuebang_flutter/lib/src/screens/messages_page.dart
```

---

## 🚨 常见问题

### 问题 1: 忘记添加某个文件

```bash
# 添加遗漏的文件
git add path/to/forgotten/file

# 修正最后一次提交（不创建新提交）
git commit --amend --no-edit

# 如果已推送到远程，需要强制推送（谨慎使用）
git push --force-with-lease origin branch-name
```

### 问题 2: 提交信息写错了

```bash
# 修改最后一次提交的信息
git commit --amend -m "新的提交信息"

# 如果已推送，需要强制推送
git push --force-with-lease origin branch-name
```

### 问题 3: 提交了不该提交的文件

```bash
# 从暂存区移除文件（保留工作区的修改）
git reset HEAD path/to/file

# 从最后一次提交中移除文件
git rm --cached path/to/file
git commit --amend --no-edit

# 添加到 .gitignore
echo "path/to/file" >> .gitignore
git add .gitignore
git commit -m "chore: 更新 .gitignore"
```

### 问题 4: 需要拆分一个大的提交

```bash
# 回退最后一次提交，保留修改
git reset HEAD~1

# 重新分步提交
git add file1
git commit -m "提交1"
git add file2
git commit -m "提交2"
```

---

## 📊 提交统计

查看本次功能的代码统计：

```bash
# 查看新增/删除的行数
git diff --stat main..feature/private-messages

# 查看详细的变更统计
git log --stat main..feature/private-messages

# 查看作者贡献统计
git shortlog -sn main..feature/private-messages
```

---

## 🎯 最佳实践

1. **提交信息格式**
   - 使用 Conventional Commits 规范
   - 类型: feat, fix, docs, style, refactor, test, chore
   - 范围: 可选，如 (ui), (api), (models)
   - 描述: 简短清晰，使用祈使句

2. **提交粒度**
   - 每个提交应该是一个逻辑完整的变更
   - 不要在一个提交中混合多个不相关的修改
   - 大功能可以分多个提交，但每个提交应该可以独立编译和测试

3. **提交频率**
   - 频繁提交小的逻辑变更
   - 不要等到功能完全完成才提交
   - 每天至少提交一次

4. **分支管理**
   - 功能开发在独立分支
   - 定期从主分支同步更新
   - 保持分支的短生命周期

---

## 📚 参考资源

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Git Best Practices](https://git-scm.com/book/en/v2)
- [How to Write Good Commit Messages](https://chris.beams.io/posts/git-commit/)

---

**文档版本**: 1.0  
**创建日期**: 2026-06-12  
**适用分支**: feature/private-messages 或 main
