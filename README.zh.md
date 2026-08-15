# dsh-plugin-prune（死插件修剪器）

**修剪 DeepSeek Harness 里的死插件** —— 统计每个插件的工具/技能被*真实*使用了
多少次、错误率与耗时如何、跨多少个会话被使用，再加上你的价值评分，标出哪些插件
可以安全移除。

## 它做什么

这是一个**纯观察型插件**：不注册任何模型工具、不改变任何业务状态。它会：

- 监听 `tools/execute` + `tools/result`，按工具和技能聚合：调用次数、错误数、
  总/平均执行耗时、渲染输出量、使用过的会话数、每日调用数（滚动 90 天窗口）。
- 在 **设置 → 插件 → 「插件体检」** 里增加一个标签页：列出所有已登记工具与
  被使用过的技能，给出机器建议（**从未被调用：很可能是死插件，建议移除** /
  错误率高 / 已标无用 / 活跃可靠），每行可一键标记 **有用 / 一般 / 无用**。
- 把统计数据持久化为 JSON：`$DSH_HOME/dsh-plugin-prune.json`
  （无 `DSH_HOME` 时回退到 `~/.dsh/dsh-plugin-prune.json`），重启后继续累计。

> 注意：统计只在**插件安装且运行期间**采集，历史使用无法回溯。

## 安装

```sh
# 从 npm 安装
dsh plugin --profile web add dsh-plugin-prune

# 从 git 仓库安装
dsh plugin --profile web add github:<your-org>/dsh-plugin-prune
```

重启 `dsh web`，打开 设置 → 插件 → 插件体检。

兼容性：`dsh >= 0.1.0-rc.5`、Node `^22.19 || >=24`、web 配置。
`engines.dsh` 会在更旧的部署上阻止安装。

## 可选配置

补丁行支持可选 config：

```yaml
- id: plugin-prune
  name: 'dsh-plugin-prune'
  config:
    debounceMs: 2000   # 持久化防抖（>= 100）
    keepDays: 90       # 每日计数保留窗口（>= 7）
    dataPath: ''       # 文件绝对路径覆盖；留空 = $DSH_HOME 默认位置
```

## 诚实的局限

- DeepSeek Harness **没有官方的"工具→插件"归属信息**。"来源插件"一列是尽力识别：
  官方内置工具靠静态目录、本插件运行期间新注册的工具靠调用栈解析、常见第三方
  工具靠小型对照表；其余显示「未知来源」。**统计数字本身始终是精确的。**
- 纯 UI 插件（主题、皮肤、布局）不产生工具调用，无法自动测量，其价值只能人工判断。
- "可以安全移除"由客观信号（频率、错误率、耗时、跨会话使用）加你自己的评分共同
  构成，卸载前请两者结合判断。

## 隐私与安全

- 数据**全部留在本机**：统计文件只包含工具名、计数、时间戳与你的评分，不上传任何内容。
- 和所有 dsh 插件一样，本包是**宿主机代码**：安装前请审查（代码量小：约 800 行，
  除 dsh 平台包外无运行时依赖），并固定版本或 commit。

## 开发

```sh
pnpm install
pnpm run check      # typecheck（host + client）+ 构建
```

结构：`src/index.ts`（host 服务）→ `lib/`；`src/client/` → 打包为
`client/client.js`（`__ModuleLoader__` factory 产物）。`cordis.patch.yml`
插入 host 行；`scripts/preflight.mjs` 守护包名接线的一致性。

## 如何发布给其他用户

1. **npm**

   ```sh
   npm publish --access public
   ```

   `prepare` 让 git 安装自动构建；`prepack` 会跑完整检查 + preflight。
   只有在 `pnpm run check` 通过后再发布版本。

2. **GitHub** —— 推送仓库并加上 **`dsh-plugin`** topic，`dsh-find-plugin`
   与社区目录就能发现它。

3. **awesome-dsh-plugin.com** —— 提交到社区精选目录，让插件市场展示。

4. **版本与 changelog** —— 打 release 标签（如 `v0.1.0`）；比起 `latest`，
   市场和用户都更喜欢固定版本。

## License

MIT
