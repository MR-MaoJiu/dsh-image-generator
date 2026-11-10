/**
 * 图片生成插件 —— Host 半边。
 *
 * 注册两样东西：
 *   1. `generate_image` 工具：调用图片后端（默认 Pollinations.ai，免费无 key；
 *      可配置 OpenAI 兼容 images API），把返回的图片字节交给 attachments
 *      服务持久化，输出 read_image 同款「信封文本 + image block」结果，
 *      使模型可见图片信息、Client 端能渲染出图。
 *   2. `image-generation` 技能：模型判断用户想生成图片时自动加载，
 *      用户也可以在技能面板直接调用，内容来自 skills/image-generation/SKILL.md。
 *
 * 注意：不 import 任何 @deepseek-ai/* 包 —— bundle 以源目录链接方式加载，
 * Node ESM 无法解析宿主 asar 内的依赖；配置读取用 cfg() 兜底默认值。
 */
import { readFileSync } from 'node:fs'

export const name = 'dsh-image-generator'
export const inject = ['tools', 'skills']

/**
 * 插件配置（cordis.patch.yml 的 config 行可覆盖；未声明 Config schema，
 * 全部字段按 cfg() 的默认值兜底）：
 * - 后端自动选择：能拿到 OpenAI key → OpenAI gpt-image-2.6-flare（最新 GPT 生图模型）；
 *   否则回退免费 pollinations。显式传 provider 参数可强制指定。
 * - OpenAI key 的读取顺序：插件配置 openaiApiKey → 宿主 credentials 服务里的
 *   openaiApiKeyEnv 引用（默认 OPENAI_API_KEY，与 profile 中 llm-pi-ai 的 apiKeyEnv
 *   保持一致，直接复用模型配置里已保存的 key）。
 * - openaiModel 可改（如 gpt-image-2.5-flare、gpt-image-2.6-sunburst）。
 */
function cfg(config, key, fallback) {
  const value = config && config[key]
  return value === undefined || value === null || value === '' ? fallback : value
}

const SIZES = ['1024x1024', '1792x1024', '1024x1792', '768x768']

/** 与 read_image 输出一致的图片值 JSON Schema（image 附件引用）。 */
const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string' },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      properties: { width: { type: 'integer' }, height: { type: 'integer' } },
    },
  },
  required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
}

/** 把 size 字符串（如 1024x1024）解析成宽高。 */
function parseSize(size) {
  const match = /^(\d+)x(\d+)$/.exec(String(size || ''))
  if (!match) return { width: 1024, height: 1024 }
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) }
}

/**
 * 读取 OpenAI key：插件配置优先，其次复用宿主 credentials 服务里已保存的 key
 * （引用名默认 OPENAI_API_KEY）。读不到返回空字符串。
 */
async function resolveOpenAiKey(ctx, config) {
  const configured = cfg(config, 'openaiApiKey', '')
  if (configured) return String(configured)
  const ref = String(cfg(config, 'openaiApiKeyEnv', 'OPENAI_API_KEY'))
  try {
    const credentials = ctx?.get?.('credentials')
    if (!credentials || typeof credentials.resolve !== 'function') return ''
    const hit = await credentials.resolve(ref)
    const value = hit?.value
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  } catch {
    return ''
  }
}

/**
 * 选择后端：显式 provider 参数优先；否则能拿到 OpenAI key 就走 openai，
 * 拿不到回退免费 pollinations。
 * @returns {Promise<{ provider: string, apiKey: string }>}
 */
async function resolveBackend(ctx, argsProvider, config) {
  if (argsProvider === 'pollinations') return { provider: 'pollinations', apiKey: '' }
  const apiKey = await resolveOpenAiKey(ctx, config)
  if (argsProvider === 'openai') return { provider: 'openai', apiKey }
  return apiKey ? { provider: 'openai', apiKey } : { provider: 'pollinations', apiKey: '' }
}

/**
 * 把请求尺寸归一化到后端支持的合法值。
 * GPT image 2.x 支持任意 WIDTHxHEIGHT（两边需被 16 整除、宽高比 1:3~3:1、
 * 最长边 ≤3840）；不合法时回退到标准尺寸。
 */
function openaiSize(size) {
  const { width, height } = size
  const ratio = width / height
  if (
    width % 16 === 0 &&
    height % 16 === 0 &&
    ratio >= 1 / 3 &&
    ratio <= 3 &&
    width <= 3840 &&
    height <= 3840
  ) {
    return `${width}x${height}`
  }
  if (width > height) return '1536x1024'
  if (height > width) return '1024x1536'
  return '1024x1024'
}

function truncate(text, max) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * 从图片后端取回图片字节。
 * @returns {Promise<{ data: Uint8Array, mediaType: string }>}
 */
async function fetchImageBytes(config, provider, apiKey, prompt, size, signal) {
  if (provider === 'openai') {
    if (!apiKey) {
      throw new Error(
        '使用 openai 后端需要 OpenAI API key：请在 DSH 设置中配置 OPENAI_API_KEY（或插件配置 openaiApiKey）',
      )
    }
    const baseUrl = String(cfg(config, 'openaiBaseUrl', 'https://api.openai.com/v1')).replace(/\/+$/, '')
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // GPT image 最新模型（gpt-image-1 已于 2026-10-23 下线）；
        // 2.x 模型总是返回 b64_json，无需 response_format。
        model: cfg(config, 'openaiModel', 'gpt-image-2.6-flare'),
        prompt,
        n: 1,
        size: openaiSize(size),
        output_format: 'png',
      }),
      signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`图片 API 返回 ${response.status}: ${truncate(body, 200)}`)
    }
    const json = await response.json()
    const base64 = json?.data?.[0]?.b64_json
    if (!base64) throw new Error('图片 API 未返回图片数据')
    return { data: new Uint8Array(Buffer.from(base64, 'base64')), mediaType: 'image/png' }
  }

  // Pollinations.ai：GET /prompt/{prompt}?params 端点（POST 端点已失效，勿用）。
  // 免费 tier：同 IP 每 45 秒 1 张，超限返回 402 {error:{code:'FREE_LIMIT',message:'... Retry after Ns ...'}}。
  // 配了 pollinationsApiKey 时加 Authorization: Bearer 头（pollen key）。
  const pollinationsKey = cfg(config, 'pollinationsApiKey', '')
  const model = cfg(config, 'pollinationsModel', 'flux')
  const query = new URLSearchParams({
    width: String(size.width),
    height: String(size.height),
    seed: String(Math.floor(Math.random() * 1_000_000)),
    nologo: 'true',
    model,
  })
  if (cfg(config, 'pollinationsEnhance', false)) query.set('enhance', 'true')

  async function requestOnce() {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${query}`
    return fetch(url, {
      headers: pollinationsKey ? { Authorization: `Bearer ${pollinationsKey}` } : {},
      signal,
    })
  }

  let response = await requestOnce()

  // 免费限流：解析 Retry after Ns，等待后重试一次；再失败把服务端消息抛给用户
  if (response.status === 402) {
    let retryMs = 0
    try {
      const json = await response.json()
      if (json?.error?.code === 'FREE_LIMIT') {
        const match = /Retry after (\d+)s/.exec(json.error.message || '')
        retryMs = match ? parseInt(match[1], 10) * 1000 : 8000
        if (json.error.message) {
          throw Object.assign(new Error(json.error.message), { retryMs })
        }
      }
    } catch (error) {
      if (error?.retryMs) {
        await new Promise((resolve) => setTimeout(resolve, error.retryMs))
        response = await requestOnce()
      } else {
        throw error
      }
    }
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Pollinations 返回 ${response.status}: ${truncate(body, 200)}`)
  }
  const buffer = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') || ''
  const mediaType = contentType.includes('png')
    ? 'image/png'
    : contentType.includes('webp')
      ? 'image/webp'
      : 'image/jpeg'
  return { data: new Uint8Array(buffer), mediaType }
}

/** 读取 skill 内容（frontmatter name/description + 正文）。 */
function loadSkillDefinition() {
  const fallback = {
    name: 'image-generation',
    description:
      'Generate an image from a text prompt using the generate_image tool. Use when the user asks to create, draw, or generate an image, illustration, poster, avatar, logo, wallpaper, or any visual from a description.',
    content:
      'Use the generate_image tool with a detailed English prompt. Call it, then report the returned image path and a short description of the result to the user.',
  }
  try {
    const raw = readFileSync(
      new URL('./skills/image-generation/SKILL.md', import.meta.url),
      'utf8',
    )
    const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw)
    if (!match) return { ...fallback, content: raw.trim() }
    const frontmatter = match[1]
    const body = match[2].trim()
    const nameMatch = /^name:\s*([a-z0-9-]+)\s*$/m.exec(frontmatter)
    const descMatch = /^description:\s*(.+)$/m.exec(frontmatter)
    return {
      name: nameMatch?.[1] ?? fallback.name,
      description: descMatch?.[1] ?? fallback.description,
      content: body,
    }
  } catch (error) {
    return fallback
  }
}

export function apply(ctx, config) {
  // ---------- 1. 注册 generate_image 工具 ----------
  ctx.tools.register(
    {
      name: 'generate_image',
      description:
        'Generate an image from a text prompt. Returns the saved image as an attachment plus its path and metadata. Use this whenever the user asks for a picture, illustration, poster, logo, avatar, wallpaper, or any visual created from a description.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description:
              'Detailed English description of the image: subject, style, composition, lighting, colors, and mood.',
          },
          size: {
            type: 'string',
            enum: SIZES,
            default: '1024x1024',
            description: 'Output image size as WxH in pixels.',
          },
          provider: {
            type: 'string',
            enum: ['pollinations', 'openai'],
            description:
              'Backend to use. Omit to auto-select: OpenAI gpt-image-2.6-flare when an OpenAI key (OPENAI_API_KEY credential) is available, otherwise the free Pollinations backend.',
          },
        },
        required: ['prompt'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            image: IMAGE_VALUE_SCHEMA,
            prompt: { type: 'string' },
            size: { type: 'string' },
            provider: { type: 'string' },
          },
          required: ['path', 'image'],
        },
        render: (_args, value) => {
          const image = value.image
          // 与 read_image 一致的信封文本，模型可读、Client 端据此渲染图卡
          const text = `<path>${value.path}</path>\n<type>image</type>\n<content>\n${image.mediaType} image, ${image.width}x${image.height} px, ${image.bytes} bytes\n</content>`
          return [
            { type: 'text', text },
            { type: 'image', attachment: image },
          ]
        },
        presentationMeta: (_args, value) => ({
          path: value.path,
          prompt: value.prompt,
          size: value.size,
          provider: value.provider,
          width: value.image.width,
          height: value.image.height,
        }),
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `生成图片 · ${truncate(args.prompt, 60)}`,
      }),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const prompt = String(args.prompt ?? '').trim()
        if (!prompt) throw new Error('prompt 不能为空：请描述要生成的图片内容')
        const { provider, apiKey } = await resolveBackend(ctx, args.provider, config)
        const size = parseSize(args.size)

        const timeoutMs = Number(cfg(config, 'timeoutMs', 120000)) || 120000
        const signals = [AbortSignal.timeout(timeoutMs)]
        if (exec?.signal) signals.push(exec.signal)
        const signal = AbortSignal.any(signals)

        const { data, mediaType } = await fetchImageBytes(
          config,
          provider,
          apiKey,
          prompt,
          size,
          signal,
        )

        const attachments = ctx.get('attachments')
        if (!attachments) throw new Error('附件服务不可用，无法保存生成的图片')
        const extension =
          mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png'
        const fileName = `generated-${Date.now()}.${extension}`
        const ref = await attachments.saveImage({ data, mediaType, name: fileName })

        return {
          path: fileName,
          image: { ...ref },
          prompt,
          size: `${size.width}x${size.height}`,
          provider,
        }
      },
    },
  )

  // ---------- 2. 注册 image-generation 技能 ----------
  const skill = loadSkillDefinition()
  ctx.skills.register({
    name: skill.name,
    description: skill.description,
    whenToUse:
      'Load when the user asks to create, draw, or generate an image, illustration, poster, avatar, logo, or any visual from a text description.',
    source: 'dsh-image-generator',
    content: skill.content,
    metadata: { bundle: 'dsh-image-generator' },
  })
}
