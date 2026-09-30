import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, del, streamSSE } from '@/lib/api'
import { formatMoney } from '@/lib/utils'
import { Bot, Send, FileText, Star, Wifi, WifiOff, Trash2, Sparkles, TrendingUp, AlertTriangle } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toast } from '@/lib/toast'

export default function AdminAI() {
  const [activeTab, setActiveTab] = useState<'config' | 'chat' | 'tools'>('config')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-lg font-medium flex items-center gap-2">
        <Bot size={20} className="text-tan" />
        AI 助手
      </h1>

      {/* 分段切换：活动底片滑移（借鉴 MicroKit glide 指示器） */}
      <div className="flex gap-1 glass-card p-1 w-fit relative" role="tablist" aria-label="AI 助手视图">
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 left-1 rounded-lg bg-tan/15 transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none"
          style={{
            width: 'calc((100% - 16px) / 3)',
            transform: `translateX(calc(${['config', 'chat', 'tools'].indexOf(activeTab)} * 100% + ${['config', 'chat', 'tools'].indexOf(activeTab)} * 4px))`,
          }}
        />
        {(['config', 'chat', 'tools'] as const).map(tab => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`relative z-10 px-4 py-1.5 rounded-lg text-sm transition-colors ${
              activeTab === tab ? 'text-tan' : 'text-white/40 hover:text-white/60'
            }`}
          >
            {{ config: '配置', chat: '对话', tools: '工具' }[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'config' && <AIConfig />}
      {activeTab === 'chat' && <AIChat />}
      {activeTab === 'tools' && <AITools />}
    </div>
  )
}

// ── 配置 ─────────────────────────────────────────────────
function AIConfig() {
  const queryClient = useQueryClient()
  const { data: config } = useQuery({
    queryKey: ['ai-config'],
    queryFn: () => get('/api/ai/config'),
  })

  const [form, setForm] = useState<any>(null)
  const currentForm = form || config || {}
  const status = config?.endpointStatus

  const saveMutation = useMutation({
    mutationFn: (data: any) => post('/api/ai/config', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-config'] })
      toast.success('AI 配置已保存')
    },
    onError: (e: any) => toast.error(e?.message || '保存失败'),
  })
  const testMutation = useMutation({
    mutationFn: () => post('/api/ai/test'),
    onSuccess: (data: any) => {
      if (data?.ok) toast.success(`连接成功: ${data.response || ''}`)
      else toast.error(data?.error || '测试失败')
    },
    onError: (e: any) => toast.error(e?.message || '测试失败'),
  })

  return (
    <div className="space-y-4 max-w-lg">
      <div className="glass-card p-5 space-y-4">
        <h3 className="text-sm text-white/50">AI 服务配置（OpenAI 兼容）</h3>

        {/* 在线状态指示灯 */}
        {status && (
          <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${
            status.online ? 'bg-moss/10 text-moss' : 'bg-cinnabar/10 text-cinnabar'
          }`}>
            {status.online ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>
              {status.online
                ? `AI 端点在线 — ${status.url}`
                : `AI 端点不可达 — ${status.url || '未配置'}${status.error ? `（${status.error}）` : ''}`
              }
            </span>
          </div>
        )}

        {/* API Base URL */}
        <div>
          <label className="text-xs text-white/40 block mb-1">API 地址（不含 /v1）</label>
          <input
            type="text"
            value={currentForm.baseUrl || ''}
            onChange={e => setForm({ ...currentForm, baseUrl: e.target.value })}
            placeholder="https://api.deepseek.com"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:border-tan/40 focus:outline-none"
          />
          <div className="text-[10px] text-white/25 mt-1">任意 OpenAI 兼容端点：DeepSeek / Ollama / LM Studio 等</div>
        </div>

        {/* API Key */}
        <div>
          <label className="text-xs text-white/40 block mb-1">API Key（本地端点可留空）</label>
          <input
            type="password"
            autoComplete="new-password"
            value={currentForm.apiKey || ''}
            onChange={e => setForm({ ...currentForm, apiKey: e.target.value })}
            placeholder={config?.hasApiKey ? '已配置（重新输入可覆盖）' : 'sk-...'}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:border-tan/40 focus:outline-none"
          />
        </div>

        {/* 模型 */}
        <div>
          <label className="text-xs text-white/40 block mb-1">模型</label>
          <input
            type="text"
            value={currentForm.model || ''}
            onChange={e => setForm({ ...currentForm, model: e.target.value })}
            placeholder="deepseek-chat"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-tan/40 focus:outline-none"
          />
        </div>

        {/* 启用 */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/60">启用 AI</span>
          <button
            onClick={() => setForm({ ...currentForm, enabled: !currentForm.enabled })}
            className={`w-10 h-5 rounded-full transition-colors relative ${currentForm.enabled ? 'bg-tan' : 'bg-white/10'}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${currentForm.enabled ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={() => saveMutation.mutate(currentForm)} disabled={saveMutation.isPending}
            className="flex-1 bg-tan text-white py-2 rounded-lg text-sm active:scale-[0.97] disabled:opacity-50">
            {saveMutation.isPending ? '保存中...' : '保存'}
          </button>
          <button onClick={() => testMutation.mutate()} disabled={testMutation.isPending}
            className="flex-1 glass-card py-2 text-center text-sm text-white/50 hover:text-white/80">
            {testMutation.isPending ? '测试中...' : '测试连接'}
          </button>
        </div>

        {testMutation.data && (
          <div className={`text-xs p-2 rounded ${(testMutation.data as any).ok ? 'bg-moss/10 text-moss' : 'bg-cinnabar/10 text-cinnabar'}`}>
            {(testMutation.data as any).ok ? `连接成功: ${(testMutation.data as any).response}` : `失败: ${(testMutation.data as any).error}`}
          </div>
        )}
        {saveMutation.isSuccess && <div className="text-xs text-moss">已保存</div>}
      </div>
    </div>
  )
}

// ── 对话（SSE 流式）─────────────────────────────────────
function AIChat() {
  const qc = useQueryClient()
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamBuf, setStreamBuf] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const { data: history } = useQuery({
    queryKey: ['ai-chats'],
    queryFn: () => get<{ messages: Array<{ role: string; content: string }> }>('/api/ai/chats'),
  })

  useEffect(() => {
    if (history?.messages?.length) setMessages(history.messages)
  }, [history])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuf])

  const clearMutation = useMutation({
    mutationFn: () => del('/api/ai/chats'),
    onSuccess: () => setMessages([]),
  })

  const [confirmState, setConfirmState] = useState<{
    open: boolean
    onConfirm: () => void
    message: string
  }>({ open: false, onConfirm: () => {}, message: '' })

  const handleSend = async () => {
    const message = input.trim()
    if (!message || streaming) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: message }])
    setStreamBuf('')
    setStreaming(true)
    try {
      const stream = streamSSE('/api/ai/chat/stream', {
        method: 'POST',
        body: { message },
        onEvent: (ev) => {
          if (typeof ev.delta === 'string') setStreamBuf(b => b + ev.delta)
        },
        onDone: (full) => {
          setMessages(prev => [...prev, { role: 'assistant', content: full }])
          setStreamBuf('')
          qc.invalidateQueries({ queryKey: ['ai-chats'] })
        },
        onError: (msg) => {
          setMessages(prev => [...prev, { role: 'assistant', content: `错误: ${msg}` }])
          setStreamBuf('')
        },
      })
      cancelRef.current = stream.cancel
      await stream.finished
    } catch (e) {
      console.error('[AIChat] stream error', e)
    } finally {
      setStreaming(false)
      cancelRef.current = null
    }
  }

  // 组件卸载时取消进行中的流，避免 setState on unmounted
  useEffect(() => () => { cancelRef.current?.() }, [])

  return (
    <div className="glass-card flex flex-col h-[500px]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <span className="text-xs text-white/30">{messages.length} 条对话 · 流式</span>
        {messages.length > 0 && (
          <button
            onClick={() => setConfirmState({ open: true, message: '清空所有对话记录？', onConfirm: () => clearMutation.mutate() })}
            className="flex items-center gap-1 text-xs text-white/30 hover:text-red-400 transition-colors"
          >
            <Trash2 size={12} /> 清空
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="text-center text-white/20 text-sm py-8">
            <Bot size={32} className="mx-auto mb-2 text-white/10" />
            试试问：今天营收多少？哪个技师表现最好？
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${
              msg.role === 'user' ? 'bg-tan/20 text-white/90' : 'bg-white/5 text-white/70'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {(streaming || streamBuf) && (
          <div className="flex justify-start">
            <div className="bg-white/5 px-3 py-2 rounded-xl text-sm text-white/70 whitespace-pre-wrap min-h-[2rem]">
              {streamBuf || <span className="text-white/40">思考中...</span>}
              {streamBuf && <span className="inline-block w-1.5 h-4 ml-0.5 bg-tan/70 animate-pulse align-middle" />}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="p-3 border-t border-white/5 flex gap-2">
        <input
          type="text" value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="问我任何经营问题..."
          disabled={streaming}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-tan/40 focus:outline-none disabled:opacity-50"
        />
        <button onClick={handleSend} disabled={streaming || !input.trim()}
          className="bg-tan text-white px-3 py-2 rounded-lg active:scale-[0.97] disabled:opacity-50">
          <Send size={16} />
        </button>
      </div>
      <ConfirmDialog
        open={confirmState.open}
        message={confirmState.message}
        variant="danger"
        confirmLabel="清空"
        onConfirm={() => { confirmState.onConfirm(); setConfirmState({ open: false, onConfirm: () => {}, message: '' }) }}
        onCancel={() => setConfirmState({ open: false, onConfirm: () => {}, message: '' })}
        loading={clearMutation.isPending}
      />
    </div>
  )
}

// ── 工具：评分 / 日报（流式）/ 预测 / 异常 ─────────────
function AITools() {
  const qc = useQueryClient()
  const scoreMutation = useMutation({ mutationFn: () => post('/api/ai/score-technicians') })
  const [reportStream, setReportStream] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [reportErr, setReportErr] = useState('')
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => () => { cancelRef.current?.() }, [])

  const forecastQ = useQuery({
    queryKey: ['ai-forecast'],
    queryFn: () => get('/api/ai/forecast?days=30&horizon=7'),
  })
  const anomalyQ = useQuery({
    queryKey: ['ai-anomalies'],
    queryFn: () => get('/api/ai/anomalies'),
    refetchInterval: 60000,
  })

  const runReportStream = async () => {
    setReportStream('')
    setReportErr('')
    setReportBusy(true)
    try {
      const stream = streamSSE('/api/ai/daily-report/stream', {
        method: 'GET',
        onEvent: (ev) => {
          if (typeof ev.delta === 'string') setReportStream(b => b + ev.delta)
        },
        onDone: (full) => setReportStream(full),
        onError: (msg) => setReportErr(msg),
      })
      cancelRef.current = stream.cancel
      await stream.finished
    } catch (e) {
      console.error('[AITools] report stream error', e)
    } finally {
      setReportBusy(false)
      cancelRef.current = null
    }
  }

  const fc = forecastQ.data?.forecast
  const anomalies: any[] = anomalyQ.data?.anomalies || []

  return (
    <div className="space-y-3">
      <div className="space-y-3 max-w-lg">
        <div className="glass-card p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium flex items-center gap-2"><Star size={14} className="text-tan" /> AI 技师月度评分</div>
            <div className="text-xs text-white/30 mt-0.5">大模型分析评价文本，多维度打分</div>
          </div>
          <button onClick={() => scoreMutation.mutate()} disabled={scoreMutation.isPending}
            className="bg-tan text-white px-3 py-1.5 rounded-lg text-xs active:scale-[0.97] disabled:opacity-50">
            {scoreMutation.isPending ? '评分中...' : '立即评分'}
          </button>
        </div>
        {scoreMutation.data && (
          <div className="glass-card p-3 text-xs space-y-1">
            {(scoreMutation.data as any).results?.map((r: any) => (
              <div key={r.id || r.name} className="flex justify-between">
                <span>{r.name}</span>
                <span className="text-tan">{r.score ? `${r.score}分 — ${r.summary}` : r.msg || r.error}</span>
              </div>
            ))}
          </div>
        )}

        <div className="glass-card p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium flex items-center gap-2"><FileText size={14} className="text-moss" /> AI 经营日报</div>
            <div className="text-xs text-white/30 mt-0.5">SSE 流式逐字生成</div>
          </div>
          <button onClick={runReportStream} disabled={reportBusy}
            className="bg-moss/80 text-white px-3 py-1.5 rounded-lg text-xs active:scale-[0.97] disabled:opacity-50">
            {reportBusy ? '生成中...' : '生成日报'}
          </button>
        </div>
        {(reportStream || reportErr) && (
          <div className="glass-card p-3 text-sm text-white/70 whitespace-pre-wrap">
            {reportStream || reportErr}
            {reportBusy && reportStream && <span className="inline-block w-1.5 h-4 ml-0.5 bg-moss animate-pulse align-middle" />}
          </div>
        )}
      </div>

      {/* 营收预测 */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <TrendingUp size={14} className="text-tan" /> 营收预测
            <span className="text-[10px] text-white/30 font-normal">{fc?.trend || '…'} · 未来 7 日</span>
          </div>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['ai-forecast'] })}
            className="text-xs text-white/40 hover:text-white/70">刷新</button>
        </div>
        {fc ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-[10px] text-white/40">日均</div>
                <div className="text-sm text-tan">{formatMoney(fc.avgDaily)}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-[10px] text-white/40">7日合计</div>
                <div className="text-sm text-moss">{formatMoney(fc.next7Total)}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-[10px] text-white/40">趋势</div>
                <div className="text-sm">{fc.trend}</div>
              </div>
            </div>
            <div className="flex items-end gap-1 h-20" aria-label="未来预测柱状图">
              {fc.daily?.map((d: any) => {
                const max = Math.max(...fc.daily.map((x: any) => x.predicted), 1)
                const h = Math.max(4, Math.round((d.predicted / max) * 100))
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date} ${formatMoney(d.predicted)}`}>
                    <div className="w-full bg-tan/40 rounded-t" style={{ height: `${h}%` }} />
                    <div className="text-[8px] text-white/30">{d.date.slice(5)}</div>
                  </div>
                )
              })}
            </div>
            {forecastQ.data?.commentary && (
              <div className="text-xs text-white/50 border-t border-white/5 pt-2 whitespace-pre-wrap">
                <Sparkles size={12} className="inline text-tan mr-1" />
                {forecastQ.data.commentary}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-white/30">加载中…</div>
        )}
      </div>

      {/* 异常检测 */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-300" /> 异常检测
            <span className="text-[10px] text-white/30 font-normal">{anomalies.length} 项</span>
          </div>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['ai-anomalies'] })}
            className="text-xs text-white/40 hover:text-white/70">重扫</button>
        </div>
        {anomalies.length === 0 ? (
          <div className="text-xs text-moss">未发现显著异常</div>
        ) : (
          <ul className="space-y-2">
            {anomalies.map((a, i) => (
              <li key={i} className={`flex gap-2 text-xs p-2 rounded-lg ${
                a.severity === 'high' ? 'bg-cinnabar/10 text-cinnabar/90' : 'bg-amber-300/10 text-amber-200/90'
              }`}>
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">{a.title}</div>
                  <div className="opacity-80 mt-0.5">{a.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {anomalyQ.data?.brief && (
          <div className="text-xs text-white/50 border-t border-white/5 pt-2 mt-2 whitespace-pre-wrap">
            <Bot size={12} className="inline text-tan mr-1" />
            {anomalyQ.data.brief}
          </div>
        )}
      </div>
    </div>
  )
}
