# ToolBox · 桌面小工具箱

基于 Tauri 2 的 Windows 桌面工具箱，侧边栏导航，可持续添加新工具。内置工具：

| 工具 | 功能 |
|------|------|
| 大小写转换 | 全大写 / 全小写 / 首字母大写 / 句首大写，以及 camelCase、PascalCase、snake_case、kebab-case、CONSTANT_CASE 互转，实时转换 + 一键复制 |
| 时间戳转换 | 当前秒/毫秒时间戳实时显示；时间戳 → 各时区日期时间（自动识别秒、毫秒、微秒、纳秒，可添加多个时区对比，含夏令时）；日期时间 → 时间戳（可指定按哪个时区解释输入的时间字符串），支持自由格式如 `2026-09-24 09:00`、`2026/9/4 9:5` |
| JSON 格式化 | 宽松解析（支持 `//` 与块注释、尾随逗号），树形视图可折叠、数组/对象显示元素个数徽标，悬停任意节点可 ✂ 从结果中移除（不影响输入的原始 JSON），「还原」撤销全部裁剪；格式化 / 压缩一行 / 去注释三种输出，解析失败提示行列位置 |
| 便签 | 快速文本片段：录入名称 + 内容（如 `aa` → `Aa123456789`），在任意应用中唤起工具箱输入名称回车，内容会**直接粘贴到之前的输入位置**（写剪贴板 → 隐藏工具箱 → 切回原窗口 → 模拟 Ctrl+V），支持增删改，数据仅存本机 |
| 全局搜索（顶栏） | uTools 式统一入口：输入便签名 → 粘贴到之前的窗口；纯数字 → 时间戳转换并自动填入；JSON 文本 → 格式化并自动填入；工具名 → 打开工具；其他文字 → 搜索并启动本机应用（开始菜单索引）。↑↓ 选择、回车执行、Esc 关闭；Ctrl+K 聚焦搜索框，快捷键唤起窗口时自动聚焦 |

时区逻辑（IANA 时区格式化、UTC 偏移、墙上时间 → 时间戳、夏令时边界处理）在 `ui/tools/tz.js`，JSON 解析（注释剥离、尾随逗号、宽松解析、结构统计）在 `ui/tools/jsoncore.js`，均可独立测试：

```bash
node scripts/test_tz.js        # 33 项断言
node scripts/test_jsoncore.js  # 21 项断言
```

深链：`index.html#timestamp` 直达时间戳工具；`index.html#timestamp@Asia/Tokyo,America/New_York` 可预置时区对比列表。

深浅色主题：侧边栏底部按钮切换；默认跟随系统（Windows 深浅色设置），手动切换后记忆在 localStorage（清除该存储可恢复跟随系统）。

## 直接使用

构建产物是免安装绿色版单文件：

```
src-tauri/target/release/toolbox.exe
```

双击即可运行（首次启动 Windows Defender SmartScreen 若提示，点「仍要运行」即可，因为是未签名的本地构建）。

**托盘常驻**：点窗口 × 只是隐藏到系统托盘（不退出），托盘图标左键点击可唤起窗口，右键菜单可「显示主窗口 / 退出」；全局快捷键（默认 **Ctrl+Q**，可在应用内「设置」中录制修改）随时唤起 / 隐藏窗口；重复双击 exe 不会开第二个实例，而是把已有窗口唤到前台。真正退出请用托盘右键菜单的「退出」。

**设置页**（侧边栏底部 ⚙ 设置，不占用工具列表）：

| 设置项 | 说明 |
|--------|------|
| 全局快捷键 | 点「修改」后按下想要的组合键即可（需包含 Ctrl / Alt / Shift 之一），立即生效，冲突时提示 |
| 开机自动启动 | 写入系统注册表 Run 项 |
| 窗口置顶 | 始终保持在其他窗口之上 |
| 点 × 隐藏到托盘 | 关闭后可取消，使点 × 直接退出应用 |

快捷键与窗口行为保存在 localStorage（WebView2 用户数据目录），开机自启保存在系统注册表。

## 请作者喝咖啡 ☕

如果这个工具箱对你有帮助，欢迎请作者喝杯咖啡，是持续更新的动力～

<p align="center">
  <img src="docs/donate-wechat.jpg" width="240" alt="微信收款码" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/donate-alipay.jpg" width="240" alt="支付宝收款码" />
</p>
<p align="center">
  <sub>微信支付（左） · 支付宝（右），金额不限，心意最浓 🙌</sub>
</p>

## 开发

环境要求：Rust 1.77+（MSVC 工具链）、WebView2 Runtime（Win10/11 自带）。前端为零 npm 依赖的纯静态页面，无需 Node。

```bash
cd src-tauri
cargo build --release   # 构建，产物在 target/release/toolbox.exe
cargo run               # 调试运行（带控制台，便于看报错）
```

## 如何新增一个工具

1. 在 `ui/tools/` 下新建 `mytool.js`，内容形如：

```js
(function () {
  registerTool({
    id: 'my-tool',          // 唯一 id
    name: '我的工具',        // 侧边栏显示名
    icon: '🔧',              // 侧边栏图标（字符）
    mount(panel) {           // panel 是该工具的容器 <section>，首次点击时调用一次
      panel.innerHTML = '<h2>你好</h2>';
    },
  });
})();
```

2. 在 `ui/index.html` 中、`app.js` 之前引入：`<script src="tools/mytool.js"></script>`

完成。侧边栏与面板切换由框架自动处理。可复用的公共能力在 `ui/app.js`：`copyText(text, btn)`（带“已复制”反馈）和 `copyButton(getText)`。

## 项目结构

```
toolbox/
├── ui/                    # 前端（构建时整体嵌入 exe）
│   ├── index.html
│   ├── style.css          # 深色主题
│   ├── app.js             # 框架：侧边栏、hash 深链路由
│   ├── core.js            # 框架：工具注册表、复制工具函数
│   └── tools/
│       ├── case.js        # 大小写转换
│       ├── tz.js          # 时区纯函数（可独立单测）
│       ├── timestamp.js   # 时间戳转换
│       ├── jsoncore.js    # JSON 宽松解析纯函数（可独立单测）
│       └── json.js        # JSON 格式化（树形视图 + 格式化/压缩/去注释）
├── src-tauri/
│   ├── src/main.rs        # Tauri 入口（无自定义命令，逻辑全在前端）
│   ├── tauri.conf.json    # 窗口与打包配置
│   └── icons/icon.ico
└── scripts/
    ├── make_icon.py       # 图标生成脚本（纯字节构造，可改样式后重新生成）
    ├── test_tz.js         # 时区逻辑单元测试（node 运行）
    ├── cdp_shot.js        # CDP 自动化验证：真实点击/输入 + 断言 + 截图
    └── shot.ps1           # 运行截图辅助脚本
```

UI 自动化验证方式（cdp_shot.js）：以调试端口启动应用后运行，脚本会真实输入时间戳、点开下拉、断言数值并截图：

```bash
export WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
src-tauri/target/release/toolbox.exe &   # Windows 下正常启动即可，环境变量会被 WebView2 读取
node scripts/cdp_shot.js                 # 14 项断言 + 2 张截图
```
