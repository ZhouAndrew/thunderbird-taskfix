# Thunderbird 实验版成功记录 — 2026-09-30

## 目标

建立一个用于测试 Thunderbird / TaskFix 修改的独立实验版，同时满足：

- Thunderbird 程序与正式版分离；
- 邮件、Calendar、Tasks 等真实数据不隔离；
- 实验版与正式版共享同一个工作 Profile；
- 每次启动实验版前自动备份 Profile；
- 正式版与实验版不得同时运行；
- 实验版加入 Cinnamon 应用程序菜单，并有桌面启动器。

---

## 最终成功方案

### 1. 实验版程序来源

**不要重新猜 Thunderbird 的系统目录结构。**

直接复用此前已经成功运行过的 TaskFix Thunderbird 程序作为母版，并复制成实验版。

优先使用的已验证母版目录：

```text
~/.local/opt/thunderbird-taskfix-153.1.0
```

如果实际机器上使用的是其他此前成功版本，也可以从：

```text
~/.local/opt/thunderbird-taskfix-153.1.0esr
~/.local/opt/thunderbird-taskfix-recurring-safe-153.1.0
```

中选择存在且可执行的版本。

实验版程序目录：

```text
~/.local/opt/thunderbird-experiment-153.1.0
```

核心原则：

```text
已成功工作的 TaskFix Thunderbird
                │
                │ 完整复制
                ▼
      Thunderbird 实验版
```

而不是重新从 `/usr/lib`、`/usr/share` 等系统目录拼装 Thunderbird。

---

### 2. 真实工作 Profile

最终确认的真实工作 Profile：

```text
/home/andrew/.local/share/thunderbird-taskfix/profile
```

这是实验版和正式版共享的数据源。

2026-09-30 重新识别时，该 Profile 大约：

```text
Profile 总大小：75 MB
邮件数据：26 MB
Calendar 数据：14 MB
```

并包含实际工作数据。

此前误选的：

```text
/home/andrew/.thunderbird/4vs0bf41.default-esr-1
```

只有约 17 MB，邮件与 Calendar 数据均为 0 MB，不是正确工作 Profile。

---

### 3. 已验证的启动方式

沿用过去已经在真实机器上成功使用的 Profile 启动方式：

```bash
thunderbird -profile "/home/andrew/.local/share/thunderbird-taskfix/profile"
```

实验版则使用实验程序本体：

```bash
~/.local/opt/thunderbird-experiment-153.1.0/thunderbird \
  -profile "/home/andrew/.local/share/thunderbird-taskfix/profile"
```

不要为了“更现代”而随意更换已经验证成功的启动方式。

---

## 数据保护

实验版和正式版直接共享真实 Profile，因此：

### 必须遵守

```text
正式 Thunderbird
        │
        ├──────────────┐
        │              │
        ▼              ▼
  共享工作 Profile   实验 Thunderbird
```

**两者不得同时运行。**

实验启动器必须先检查是否已经有 Thunderbird 进程运行。

每次实验版启动前，先完整备份：

```text
/home/andrew/.local/share/thunderbird-taskfix/profile
```

到：

```text
~/Thunderbird-Experiment-Backups/
```

备份使用：

```bash
cp -a --reflink=auto
```

在 Btrfs 等支持 reflink 的文件系统上，可快速建立安全快照。

---

## 菜单和启动入口

实验版应有独立启动器：

```text
~/.local/bin/thunderbird-experiment
```

Cinnamon 应用程序菜单：

```text
~/.local/share/applications/thunderbird-experiment.desktop
```

桌面入口：

```text
~/Desktop/Thunderbird-实验版.desktop
```

菜单名称：

```text
Thunderbird 实验版
```

---

## 2026-09-30 Human-path 验收结果

最终实验版成功启动，并实际显示了原有真实数据。

截图中已确认：

- Tasks 界面正常打开；
- 大量历史与当前 Tasks 可见；
- Completed / In Process / Needs Action 等状态可见；
- Category 列有真实分类；
- Calendar 列有真实来源；
- 左侧真实 Calendar 列表正常出现；
- 可见 `thunderbird`；
- 可见 `thunderbird-in-time`；
- 可见 `wordpress`；
- 可见其他长期使用的日历；
- 原有账户环境存在；
- UI 已进入真实工作环境，而不是空 Profile。

因此这次才算真正完成：

```text
程序可以启动
        +
真实工作数据完整可见
        +
正式程序未被覆盖
        +
实验启动前有备份
        =
Human-path 验收通过
```

---

## 本次连续失败的原因

### 失败 1：猜错 Profile

最初从 `installs.ini` 中拿到第一个 `Default` 就认为它是当前工作 Profile。

这是错误的。

机器上存在多个 Thunderbird Profile 和历史安装记录，因此：

```text
配置中叫 Default
    ≠
当前真正使用的数据 Profile
```

必须结合实际数据量、目录内容、最近使用情况和最终人工界面验证。

### 失败 2：把 `/usr/bin` 当成程序目录

曾出现：

```text
/usr/bin
    ↓
thunderbird-experiment
```

这实际上是在复制整个 `/usr/bin`，显然错误。

仅根据：

```bash
command -v thunderbird
readlink -f ...
```

不能直接推导 Thunderbird 完整程序根目录。

### 失败 3：猜 `/usr/share/thunderbird`

之后又假定当前 Mint / Thunderbird 153.1.0esr 必须存在：

```text
/usr/share/thunderbird
```

但实机并没有该路径。

这是把其他 Debian/Ubuntu 包布局经验套到当前机器，而不是先复用历史成功方案。

### 失败 4：把 `--version` 当成可运行验收

程序能够：

```bash
thunderbird --version
```

只说明二进制能启动并打印版本。

它不能证明：

- XUL / Chrome resource 可加载；
- `resource://gre/modules/...` 能解析；
- GUI 能启动；
- Profile 能正常打开；
- Calendar / Tasks / 邮件能加载。

因此：

```text
version check
    ≠
application startup acceptance
    ≠
human-path acceptance
```

---

## 最重要的经验

### 1. 已有成功路径时，先复用，不要重新发明

这台机器过去已经多次成功运行过 TaskFix Thunderbird。

因此以后做同类实验环境时，优先：

```text
复制已成功运行过的程序
        +
使用已成功运行过的 Profile 启动方式
```

而不是重新研究 Thunderbird packaging。

### 2. 数据丰富的软件，数据本身比程序副本更重要

长期积累的：

- 邮件；
- Calendar；
- Tasks；
- Category；
- Status；
- 账户设置；
- 扩展配置；

才是最需要保护的资产。

因此实验前备份不是附加功能，而是实验环境的一部分。

### 3. “完成”的标准必须是 Human-path

以后 Thunderbird / TaskFix 的完成标准不能是：

```text
脚本返回 0
```

也不能是：

```text
Thunderbird 能打开
```

而必须是：

```text
从用户实际入口启动
    ↓
真实账户存在
    ↓
真实 Calendar 存在
    ↓
真实 Tasks 存在
    ↓
Category / Status 等数据正常
    ↓
目标修改可以真实使用
```

通过以后才能称为完成。

---

## 当前基线

截至 2026-09-30，实验 Thunderbird 的正确设计基线为：

```text
程序：
  独立实验副本

数据：
  /home/andrew/.local/share/thunderbird-taskfix/profile

保护：
  每次实验启动前完整备份

并发：
  正式版与实验版禁止同时运行

启动：
  -profile <working-profile>

验收：
  必须进行真实 GUI / Tasks / Calendar 人工路径验收
```

这份记录应作为以后继续开发 Thunderbird TaskFix / 实验版时的首要参考，避免再次重复已解决的问题。
