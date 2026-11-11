/**
 * 图片生成插件 —— Client 半边。
 *
 * 注册 `tool.call.toolview` 的 key: 'generate_image' 工具视图，视觉参考 Codex：
 *   - preparing：一行轻提示（等待参数解析）
 *   - start：深灰圆角「生成画布」—— 动态点阵网格（流动 + 呼吸），底部绿色
 *     百分比胶囊（进度随时间缓动逼近 95%）
 *   - result：图片直接大图展示（淡入揭示），不套卡片边框、不加元信息标签
 *   - 失败：一行红色错误文字
 */
window.__ModuleLoader__.load({
  id: 'dsh-image-generator',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement

    const CSS_ID = 'dsh-image-generator'

    /** 动效样式。生成画布固定深色（与 Codex 一致），其余跟随宿主主题变量。 */
    const CSS = [
      /* 生成中：点阵画布（宽高比由目标尺寸内联决定，避免出图时布局跳动） */
      '.gig_canvas{position:relative;max-width:100%;border-radius:var(--dsw-radius-lg);background:#26262a;overflow:hidden;margin:6px 0;isolation:isolate}',
      '.gig_grid{position:absolute;inset:-22px;background-image:radial-gradient(rgba(255,255,255,.16) 1px,transparent 1.3px);background-size:11px 11px;animation:gig_flow 5.5s linear infinite}',
      '@keyframes gig_flow{from{background-position:0 0}to{background-position:22px 22px}}',
      '.gig_grid2{position:absolute;inset:-34px;background-image:radial-gradient(rgba(255,255,255,.10) 1px,transparent 1.3px);background-size:17px 17px;animation:gig_flow2 9s linear infinite reverse}',
      '@keyframes gig_flow2{from{background-position:0 0}to{background-position:34px 34px}}',
      '.gig_glow{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.15),transparent 56%);animation:gig_breathe 2.6s ease-in-out infinite}',
      '@keyframes gig_breathe{0%,100%{opacity:.45;transform:scale(.9)}50%{opacity:1;transform:scale(1.14)}}',
      '.gig_pct{position:absolute;left:12px;bottom:12px;z-index:1;display:inline-flex;align-items:center;border-radius:999px;padding:4px 12px;background:rgba(0,0,0,.55);color:#3ddc84;font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;backdrop-filter:blur(6px)}',
      /* 结果：图片直接展示 */
      '.gig_reveal{animation:gig_reveal 700ms cubic-bezier(.22,.8,.24,1) both}',
      '@keyframes gig_reveal{from{opacity:0;filter:blur(10px);transform:translateY(3px)}to{opacity:1;filter:blur(0);transform:none}}',
      /* 兜底图库：官方 tool.call.images 槽位不可用时自行渲染 */
      '.gig_gallery{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}',
      '.gig_thumb{max-width:min(100%,360px);max-height:360px;border-radius:var(--dsw-radius-lg);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-secondary,transparent);object-fit:contain}',
      /* 错误态 */
      '.gig_error{display:flex;align-items:flex-start;gap:8px;padding:4px 0;color:var(--dsw-alias-state-error-primary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:18px;word-break:break-word}',
      '.gig_error svg{flex:none;margin-top:2px;width:14px;height:14px}',
      /* 轻提示 */
      '.gig_hint{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);color:var(--dsw-alias-label-tertiary);padding:2px 0}',
    ].join('\n')

    function injectCss() {
      if (typeof document === 'undefined') return
      const selector = `style[data-plugin-css="${CSS_ID}"]`
      if (document.querySelector(selector)) return
      const style = document.createElement('style')
      style.dataset.plugin = 'true'
      style.dataset.pluginCss = CSS_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /** 从 size 字符串（1024x1024）解析宽高，非法时回退方形。 */
    function parseSize(size) {
      const match = /^(\d+)x(\d+)$/.exec(String(size || ''))
      if (!match) return { width: 1024, height: 1024 }
      const width = parseInt(match[1], 10)
      const height = parseInt(match[2], 10)
      if (!(width > 0) || !(height > 0)) return { width: 1024, height: 1024 }
      return { width, height }
    }

    /**
     * 读取生成中的 size 参数：优先 PartialArguments（流式解析），
     * 退回 argsRaw JSON，最后用默认 1024x1024。
     */
    function readSize(block) {
      try {
        const args = block && block.args
        if (args && typeof args.has === 'function' && args.has('size')) {
          const text = args.text('size')
          if (typeof text === 'string' && /^\d+x\d+$/.test(text)) return text
        }
      } catch (error) {
        // PartialArguments 读取失败时退回 argsRaw
      }
      try {
        const raw = block && block.argsRaw
        if (typeof raw === 'string' && raw.length > 0) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed.size === 'string' && /^\d+x\d+$/.test(parsed.size)) {
            return parsed.size
          }
        }
      } catch (error) {
        // argsRaw 尚未构成完整 JSON，等待后续流式更新
      }
      return '1024x1024'
    }

    /** 从结果 content 中提取图片附件引用（与 read_image 相同的判定）。 */
    function extractImages(content) {
      const images = []
      if (!Array.isArray(content)) return images
      for (const block of content) {
        if (
          block &&
          block.type === 'image' &&
          block.attachment &&
          typeof block.attachment.attachmentId === 'string' &&
          block.attachment.attachmentId.length > 0
        ) {
          images.push({ attachment: block.attachment })
        }
      }
      return images
    }

    /** 从错误结果中提取人类可读信息。 */
    function errorMessage(block) {
      const err = block && block.error
      if (!err) return '图片生成失败'
      if (typeof err === 'string') return err
      const name = typeof err.name === 'string' ? err.name : ''
      const code = typeof err.code === 'string' ? ` (${err.code})` : ''
      return `${name || '图片生成失败'}${code}`
    }

    /* ---------- 三阶段组件 ---------- */

    /** preparing：一行轻提示。 */
    function PreparingRow() {
      return h('div', { className: 'gig_hint' }, '正在准备图片生成…')
    }

    /** start：Codex 风格点阵画布 + 百分比胶囊，宽高按目标图片尺寸。 */
    function GeneratingCard({ block }) {
      const [pct, setPct] = React.useState(2)
      React.useEffect(() => {
        const timer = setInterval(() => {
          setPct((value) => {
            if (value >= 95) return value
            const step = Math.max(1, Math.round((95 - value) * 0.08))
            return Math.min(95, value + step)
          })
        }, 450)
        return () => clearInterval(timer)
      }, [])
      const { width, height } = parseSize(readSize(block))
      // 宽高比与最终图片一致，宽度尽量贴近结果图（受 60vh 高度上限约束）
      const canvasStyle = {
        aspectRatio: `${width} / ${height}`,
        width: `min(100%, 720px, calc(60vh * ${width / height}))`,
        margin: '6px 0',
      }
      return h(
        'div',
        { className: 'gig_canvas', style: canvasStyle },
        h('div', { className: 'gig_grid' }),
        h('div', { className: 'gig_grid2' }),
        h('div', { className: 'gig_glow' }),
        h('div', { className: 'gig_pct' }, `${pct}%`),
      )
    }

    /** result：图片直接大图展示（Codex 风格，不套卡片）。 */
    function ResultCard({ block, renderSlot, loadImage }) {
      if (!block) return null
      if (block.isError) {
        return h(
          'div',
          { className: 'gig_error' },
          h(
            'svg',
            { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
            h('path', {
              d: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 13.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm0-9a1 1 0 0 0-1 1v5a1 1 0 0 0 2 0v-5a1 1 0 0 0-1-1Z',
              fill: 'currentColor',
            }),
          ),
          h('span', null, errorMessage(block)),
        )
      }
      const images = extractImages(block.content)
      if (images.length === 0) return null
      return h('div', { className: 'gig_reveal' }, renderGallery({ images, loadImage, renderSlot }))
    }

    /** 官方图库不可用时（槽位缺失或渲染抛错）的兜底：走 Gateway 授权的 loadImage 取 URL。 */
    function FallbackGallery({ images, loadImage }) {
      const signature = images
        .map((image) => (image && image.attachment && image.attachment.attachmentId) || '')
        .join(',')
      const [urls, setUrls] = React.useState([])
      React.useEffect(() => {
        let alive = true
        if (typeof loadImage !== 'function') {
          setUrls([])
          return () => {
            alive = false
          }
        }
        Promise.all(
          images.map((image) =>
            Promise.resolve()
              .then(() => loadImage(image))
              .catch(() => null),
          ),
        ).then(
          (resolved) => {
            if (alive) setUrls(resolved)
          },
          () => {
            if (alive) setUrls([])
          },
        )
        return () => {
          alive = false
        }
      }, [signature, loadImage])
      const ready = urls.filter((url) => typeof url === 'string' && url.length > 0)
      if (ready.length === 0) return null
      return h(
        'div',
        { className: 'gig_gallery' },
        ready.map((url, index) =>
          h('img', { key: index, className: 'gig_thumb', src: url, alt: '', loading: 'lazy' }),
        ),
      )
    }

    /**
     * 渲染结果图库。
     *
     * `tool.call.images` 子槽位由 core 的 read-image-toolview 独占声明——子槽位「只能被一个条目声明」，
     * 第二个工具视图再声明同名子槽会在加载时抛 `slot "tool.call.images" is already declared`。
     * 因此这里只复用、不声明：优先交给官方图库渲染（统一缩略图与放大行为），
     * 槽位为空或渲染报错时退回本地图库，避免把整个 toolview 拖垮。
     */
    function renderGallery({ images, loadImage, renderSlot }) {
      if (typeof renderSlot === 'function') {
        try {
          const rendered = renderSlot('tool.call.images', { images, loadImage, align: 'start' })
          if (rendered !== null && rendered !== undefined && rendered !== false) return rendered
        } catch (error) {
          // 槽位不存在（例如官方 read_image 视图被禁用）时继续走兜底
        }
      }
      return h(FallbackGallery, { images, loadImage })
    }

    /** toolview 入口：按 phase 分发。 */
    function GenerateImageToolview(props) {
      const phase = props.phase
      if (phase === 'preparing') return h(PreparingRow)
      if (phase === 'start') return h(GeneratingCard, props)
      return h(ResultCard, props)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        injectCss()
        ctx.slots.inject('tool.call.toolview', () =>
          ctx.slots.register(
            {
              name: 'tool.call.toolview',
              key: 'generate_image',
              locale: 'conversation',
              // 不声明 children：tool.call.images 已被 core 的 read-image-toolview 独占声明，
              // 重复声明会在加载时抛错（子槽位只能由一个条目声明）。
            },
            GenerateImageToolview,
          ),
        )
      },
    }
  },
})
