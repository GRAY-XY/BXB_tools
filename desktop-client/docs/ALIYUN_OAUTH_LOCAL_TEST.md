# Alibaba OAuth Local Test

先说明结论：

- 这份测试脚本验证的是：`阿里云账号网页登录授权 -> 本地拿到 OAuth token`
- 这还不等于：`百炼可以直接用这个 token 做推理`
- 也还不等于：`费用一定会自动记到用户自己的百炼账号`

## 1. 官方文档

- OAuth 应用概览  
  https://help.aliyun.com/zh/ram/overview-of-oauth-applications

- 本地应用访问阿里云 API  
  https://help.aliyun.com/zh/ram/access-alibaba-cloud-apis-from-a-native-application

- OIDC 获取用户信息  
  https://help.aliyun.com/zh/ram/obtain-user-information-through-oidc

- 百炼鉴权文档  
  https://help.aliyun.com/document_detail/2975671.html

## 2. 你需要先做什么

1. 在阿里云 RAM / OAuth 应用里创建一个 `Native` 应用。
2. 拿到这个应用的 `client_id`。
3. 确认允许回调到本地回环地址：
   `http://127.0.0.1:<port>/callback`

## 3. 本地测试命令

```powershell
C:\Users\IGpig\AppData\Local\Programs\Python\Python312\python.exe aliyun_oauth_local_test.py --client-id 你的_client_id
```

如果你不想自动打开浏览器：

```powershell
C:\Users\IGpig\AppData\Local\Programs\Python\Python312\python.exe aliyun_oauth_local_test.py --client-id 你的_client_id --no-browser
```

## 4. 成功后你会看到什么

- 脚本会打印授权链接
- 浏览器登录并授权后，本地 `127.0.0.1` 回调会收到 `code`
- 脚本会换到：
  - `access_token`
  - `refresh_token`
  - `id_token`
- 终端会输出：
  - token 是否拿到
  - 过期时间
  - `id_token` 解出来的基础用户信息

## 5. 这一步跑通后下一步该验证什么

下一步不是直接把它塞进 GUI，而是先确认：

1. 这个 OAuth token 能不能直接访问百炼需要的接口。
2. 如果不行，百炼是否必须继续走 `API Key` 或“临时鉴权 Token”。
3. 如果必须临时鉴权，那是否仍然需要你自己的后端来签发。

## 6. 当前判断

按阿里官方文档看：

- `OAuth` 这条链路本地测试是可以先跑的。
- 但百炼推理本身更像还是围绕 `API Key / 临时鉴权`。
- 所以最关键的问题不是“能不能登录阿里云”，而是：
  `登录后的用户 token 能不能直接调用百炼推理接口`

这也是这一步本地测试存在的意义：先把 OAuth 登录这一半单独验证掉。
