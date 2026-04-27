# BXB Student 桌面端控制策略

这个文件说明如何通过 GitHub 上的策略文件控制桌面端版本、登记和锁定状态。

## 1. 策略文件位置

默认读取：

`config/desktop-policy.json`

远程策略默认尝试从以下地址获取：

`https://raw.githubusercontent.com/GRAY-XY/BXB_tools/client/config/desktop-policy.json`

## 2. 可用字段

```json
{
  "version": 1,
  "enforcementEnabled": true,
  "registrationEnabled": true,
  "lockMessage": "当前账号的桌面端访问已被管理员暂时锁定。",
  "blockedUserIds": [],
  "blockedEmails": [],
  "blockedNames": [],
  "minimumSupportedVersion": "1.0.1"
}
```

## 3. 用法

- `blockedUserIds`：按平台用户 ID 封禁
- `blockedEmails`：按登录邮箱封禁
- `blockedNames`：按姓名封禁
- `minimumSupportedVersion`：强制最低版本，旧版本会直接显示升级提示并锁定
- `registrationEnabled`：控制是否记录登录用户登记

## 4. 用户登记

桌面端会在登录成功后尝试记录：

- 姓名
- 邮箱 / 登录名
- 用户 ID
- 平台
- 应用版本
- 首次出现时间
- 最近登录时间

默认 GitHub 目标文件：

`data/user-registry.json`

## 5. GitHub 写入说明

出于安全考虑，不建议把可写 GitHub Token 直接硬编码进安装包。

当前实现支持两种方式：

- 运行环境提供 `BXB_GITHUB_REGISTRY_TOKEN`
- 当前机器已安装并登录 `gh`

若两者都没有，应用会把登记信息先缓存到本地，等待后续同步。
