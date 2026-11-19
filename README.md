# DSH Image Generator

在 DeepSeek Harness（DSH）对话中直接生成图片的插件：内置 `generate_image` 工具与 `image-generation` 技能，生成过程带 Codex 风格的进度动效，结果以原生大图直接展示。

![示例：社交产品 UI 概念图](https://raw.githubusercontent.com/MR-MaoJiu/dsh-image-generator/main/docs/example-social-ui.png)

## 特性

- **一句话生成图片**：对话中直接调用 `generate_image`，图片作为附件保存并在会话中展示
- **GPT 最新生图模型优先**：自动复用 DSH 模型配置中已保存的 `OPENAI_API_KEY`，默认走 OpenAI `gpt-image-2.6-flare`；未配置 key 时自动回退到免费的 Pollinations
- **任意分辨率**：支持 `1024x1024`、`1792x1024`、`1024x1792`、`768x768`，也可传任意尺寸（宽高 16 整除、比例 1:3~3:1、最长边 ≤3840，工具自动校验归一化）
- **Codex 风格动效**：生成中显示按目标宽高比渲染的深灰点阵卡片（双层点阵流动 + 光晕呼吸 + 绿色百分比胶囊），出图时布局不跳动；完成后图片直接大图展示
- **内置技能**：`image-generation` 技能教模型如何打磨提示词、调用工具与汇报结果，用户提出图片需求时可直接使用

## 安装

### 从 npm 安装（推荐）

```bash
dsh plugin add dsh-image-generator
```

以 npm 形式安装的插件，DSH 会在插件页刷新时检查 registry 上是否有更新版本，并在有新版本时给出更新提示。

### 从 GitHub 安装

```bash
dsh plugin add git+https://github.com/MR-MaoJiu/dsh-image-generator.git
```

> 注意：GitHub 直装不会收到更新提示。DSH 只对「npm 包名」或「pin 到完整 40 位 commit 的 Git 依赖」两者之一的安装检查更新，而 `github:owner/repo` 这种形式两者都不满足，`update` 能力为 `undefined`，因此界面上不会出现更新入口。想跟进新版本请使用上面的 npm 方式。

### 本地开发安装

```bash
dsh plugin add /path/to/dsh-image-generator
```

安装完成后重启或刷新 DSH 页面即可。插件会注册：

- Host 工具 `generate_image`
- 运行时技能 `image-generation`
- Web 端工具卡片视图（`tool.call.toolview` key: `generate_image`）

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `provider` | 自动 | `openai` / `pollinations`，默认按是否配置了 key 自动选择 |
| `openaiBaseUrl` | `https://api.openai.com/v1` | OpenAI 兼容 API 地址 |
| `openaiModel` | `gpt-image-2.6-flare` | OpenAI 生图模型 |
| `openaiApiKey` | 空 | 显式指定 key；留空时自动读取 DSH 凭证中的 `OPENAI_API_KEY` |
| `openaiApiKeyEnv` | `OPENAI_API_KEY` | 凭证引用名 |
| `pollinationsModel` | `flux` | 免费后端模型 |
| `pollinationsEnhance` | `false` | 免费后端是否开启提示词增强 |
| `timeoutMs` | `120000` | 单次生成超时 |
| `outputDir` | `generated-images` | 生成图片在项目目录下的子目录；设为空串则直接写到项目目录根 |

> 未配置 OpenAI key 时自动使用 Pollinations 免费后端（同 IP 每 45 秒 1 张，尺寸会被服务端缩放）。

### 生成的图片落在哪

生成结果会落在**会话当前的工作目录**（与 `bash`、`read`、`write` 等工具解析相对路径用的是同一个目录，也就是当前项目目录）下的 `generated-images/`：

```
<项目目录>/generated-images/generated-1795074597685.png
```

工具结果里的路径就指向这个文件，带正确扩展名，可直接用系统看图软件打开。

目录可用 `outputDir` 调整；设为空串表示不建子目录、直接放在项目目录根：

```yaml
config:
  outputDir: images
```

附件存储本身是按内容寻址的（文件名是一串 sha256、没有扩展名），无法按扩展名识别为图片，因此这里额外产出一份普通文件，而不是把存储对象路径直接作为结果路径。

该目录位于项目内，若项目是 Git 仓库，建议忽略：

```gitignore
generated-images/
```

## 使用

模型在对话中会这样调用：

```json
{ "prompt": "a cozy Japanese ramen shop at night, warm lantern light, photorealistic", "size": "1792x1024" }
```

也可以显式指定后端：

```json
{ "prompt": "...", "size": "1024x1024", "provider": "pollinations" }
```

## 开发

```bash
node --check index.js
node --check client.js
```

修改后重新安装使插件生效：

```bash
dsh plugin remove dsh-image-generator
dsh plugin add ./dsh-image-generator
```

## 许可证

[MIT](LICENSE)
