# PassVault — 密码管理器设计文档

> 日期：2026-09-16  
> 状态：已确认

## 概述

一个本地运行的 Electron 桌面密码管理器，用主密码加密保护所有账号密码，无需联网，数据完全存储在本地。

## 技术栈

- **运行时**：Electron（桌面应用框架）
- **前端**：原生 HTML / CSS / JavaScript（不用框架，保持简单轻量）
- **加密**：Node.js `crypto` 模块，AES-256-GCM 对称加密
- **密钥派生**：PBKDF2（从主密码派生加密密钥，迭代 100,000 次）
- **数据存储**：加密后的 JSON 文件，存放在 Electron `app.getPath('userData')` 目录

## 目录结构

```
C:\password\
├── package.json              # Electron 依赖与启动脚本
├── src/
│   ├── main.js               # 主进程：创建窗口、文件读写、IPC
│   ├── preload.js            # 预加载脚本：暴露安全 IPC 接口
│   ├── crypto.js             # 加密/解密逻辑（AES-256-GCM + PBKDF2）
│   ├── vault-policy.js       # 密码库结构与登录失败锁定策略
│   ├── vault-service.js      # 解锁、校验、CRUD 与持久化服务
│   ├── storage.js            # 密码库文件原子写入
│   └── renderer/
│       ├── index.html        # 应用主界面
│       ├── styles.css        # 样式（深色主题，与效果图一致）
│       └── app.js            # 渲染进程逻辑（UI 交互、状态管理）
├── docs/
│   └── superpowers/specs/
│       └── 2026-09-16-passvault-design.md   # 本文件
└── .gitignore
```

## 核心功能

| 功能 | 说明 |
|------|------|
| 主密码登录 | 首次使用设置主密码，后续用它解锁密码库 |
| 密码条目 CRUD | 增删改查：名称、网址、用户名、密码、分类、备注 |
| 搜索/筛选 | 按名称、用户名、网址实时搜索；按分类筛选 |
| 密码生成器 | 可调长度（8-64）、勾选字符类型、强度提示、一键复制 |
| 复制到剪贴板 | 点击复制密码，30 秒后自动清空剪贴板 |
| 导入/导出 | 一键导出加密 JSON（主密码加密，可安全传输）；一键导入自动识别格式，换电脑迁移零成本 |
| 自动锁定 | 闲置 5 分钟自动锁定，需重新输入主密码 |

## 数据模型

```jsonc
// 加密前的明文数据结构
{
  "version": 1,
  "entries": [
    {
      "id": "uuid-v4",
      "name": "GitHub",
      "url": "https://github.com",
      "username": "chen_dev",
      "password": "明文密码",
      "category": "工作",       // 工作 | 个人 | 金融 | 娱乐
      "notes": "备注",
      "favorite": false,
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ]
}
```

## 加密方案

1. 用户输入主密码
2. 用 PBKDF2 派生 256 位密钥（salt 随机生成并存储在文件头）
3. 用 AES-256-GCM 加密整个 JSON 数据（IV 随机生成，认证标签附在密文后）
4. 存储格式：`salt(16B) + iv(12B) + authTag(16B) + ciphertext`

## IPC 通信

主进程负责文件读写和加密，渲染进程通过 `preload.js` 暴露的有限 API 调用：

```
preload 暴露的 API：
- vault.unlock(masterPassword) → boolean
- vault.getEntries() → Entry[]
- vault.saveEntry(entry) → Entry
- vault.deleteEntry(id) → void
- vault.generatePassword(options) → string
- vault.exportData(masterPassword) → string (加密 JSON)
- vault.importData(json, masterPassword) → void
```

## 错误处理

- 主密码错误：显示错误提示，限制尝试次数（5 次后锁定 1 分钟）
- 文件读取或结构校验失败：提示数据文件损坏，引导从备份恢复
- 保存使用临时文件加原子替换，写盘失败时保留原文件和内存中的未保存修改
- 保存失败：显示错误并保留内存中的修改

## 测试

- `src/crypto.js` 的加解密逻辑可单独测试（纯函数，不依赖 Electron）
- 用 Node.js 内置 `assert` 写简单单元测试
- UI 交互手动验证

## 不做的事

- 不做浏览器自动填充插件（太复杂）
- 不做云同步（本地优先）
- 不做多设备同步
- 不做密码强度审计报告


