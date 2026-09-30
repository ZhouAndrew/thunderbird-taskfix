# Thunderbird 实验环境事故反思 — 2026-09-30

## 背景

目标是建立一个独立的 Thunderbird 153.1.0esr 实验程序，与正式环境共享真实数据，并在每次实验前自动备份。

最终做成了，但中间连续出现了几次不该出现的错误。这里专门记录原因，避免以后再犯。

## 失败链

### 1. 未验证就认定 Profile

第一次根据 `installs.ini` 中最先出现的 `Default`，直接认定：

```text
~/.thunderbird/4vs0bf41.default-esr-1
```

是工作 Profile。

实际 human-path 打开后看到的 Tasks/Calendar 明显不完整。后来统计发现该 Profile 只有约 17 MB，邮件和 Calendar 数据均为 0 MB。

真正的长期工作 Profile 是：

```text
~/.local/share/thunderbird-taskfix/profile
```

约 75 MB，邮件约 26 MB，Calendar 约 14 MB。

**教训：配置文件中的“Default”不是充分证据。**

### 2. 把程序入口的位置误当成程序根目录

曾经从：

```bash
command -v thunderbird
```

得到 `/usr/bin/thunderbird`，随后把 `/usr/bin` 当成 Thunderbird 程序目录复制。

这是错误的。

**教训：入口路径、wrapper、真实程序根目录是不同概念。**

### 3. 又重新猜发行版目录结构

修正后又假定必须有：

```text
/usr/share/thunderbird
```

结果当前实机并没有这个目录。

问题不在 Thunderbird，而在开发过程没有先看此前已经成功运行的本机方案。

**教训：已有实机成功路径时，优先复用成功路径。**

### 4. 把版本输出当成运行验收

```bash
thunderbird --version
```

成功，只能证明版本查询工作。

它不能证明 GUI、resource、Profile、Calendar、Tasks 能工作。

一次失败中真正的错误是：

```text
Missing chrome or resource URL:
resource://gre/modules/Services.sys.mjs
```

**教训：version check 不能代替 application startup，更不能代替 human-path acceptance。**

## 最终为什么成功

最终没有继续重新拼 Thunderbird，而是回到以前已经在这台机器上真正成功过的方法：

```text
已成功运行的 TaskFix Thunderbird
             ↓ 完整复制
Thunderbird Experiment

工作 Profile：
~/.local/share/thunderbird-taskfix/profile

启动方式：
-profile <working-profile>
```

随后真实 GUI 验收确认：

- 原 Tasks 存在；
- Completed / In Process / Needs Action 可见；
- Category 正常；
- Calendar 来源正常；
- `thunderbird`、`thunderbird-in-time`、`wordpress` 等日历存在；
- 不是空 Profile。

这才构成完成证据。

## 以后必须遵守的开发纪律

1. **先查历史成功记录。** 同类问题已有实机解法时，不重新发明。
2. **先保护数据。** 真实 Profile 改动前必须先备份。
3. **不以路径名称猜数据。** Profile 必须通过实际内容和 human-path 确认。
4. **不以 exit code / version 输出宣布完成。**
5. **真实用户路径是最终验收。** 需要实际看到邮件、Calendar、Tasks、Category、Status 等长期数据。
6. **实验和正式程序可以隔离，数据可以共享，但共享 Profile 时不得并发运行。**
7. **把重要结论写进仓库。** 不只依赖聊天历史。

## 当前固定基线

```text
实验程序：
~/.local/opt/thunderbird-experiment-153.1.0/

真实工作数据：
~/.local/share/thunderbird-taskfix/profile

备份：
~/Thunderbird-Experiment-Backups/

启动器：
~/.local/bin/thunderbird-experiment

策略：
程序隔离
数据共享
启动前备份
禁止并发
human-path 验收
```
