import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'
import { Bot, Send, Zap, FileText, Star } from 'lucide-react'
import { useState } from 'react'

// 后台 AI 管理页：配置 + 对话 + 触发评分/日报
export default function AdminAI() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'config' | 'chat' | 'tools'>('config')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-lg font-medium flex items-center gap-2">
        <Bot size={20} className="text-tan" />
        AI 助手
      </h1>

      {/* Tab 切换 */}
      <div className="flex gap-1 glass-card p-1 w-fit">
        {[
          { id: 'config', label: '配置' },
          { id: 'chat', label: '对话' },
          { id: 'tools', label: '工具' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
              activeTab === tab.id ? 'bg-tan/15 text-tan' : 'text-white/40 hover:text-white/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'config' && <AIConfig />}
      {activeTab === 'chat' && <AIChat />}
      {activeTab === 'tools' && <AITools />}
    </div>
  )
}

// ── 配置面板 ─────────────────────────────────────────────
function AIConfig() {
  const queryClient = useQueryClient()
  const { data: config } = useQuery({
    queryKey: ['ai-config'],
    queryFn: () => get('/api/ai/config'),
  })

  const [form, setForm] = useState<any>(null)
  const currentForm = form || config || {}

  const saveMutation = useMutation({
    mutationFn: (data: any) => post('/api/ai/config', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-config'] }),
  })

  const testMutation = useMutation({
    mutationFn: () => post('/api/ai/test'),
  })

  const providers = config?.providers || {}

  return (
    <div className="space-y-4 max-w-lg">
      <div className="glass-card p-5 space-y-4">
        <h3 className="text-sm text-white/50">AI 模型配置</h3>

        {/* Provider 选择 */}
        <div>
          <label className="text-xs text-white/40 block mb-1">服务商</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(providers).map(([key, info]: [string, any]) => (
              <button
                key={key}
                onClick={() => setForm({ ...currentForm, provider: key, baseUrl: info.baseUrl, model: info.defaultModel })}
                className={`glass-card p-2 text-xs text-center transition-all ${
                  currentForm.provider === key ? 'border-tan/40 bg-tan/10 text-tan' : 'text-white/50'
                }`}
              >
                {info.name}
              </button>
            ))}
          </div>
        </div>

        {/* API Key */}
        {currentForm.provider && currentForm.provider !== 'ollama' && (
          <div>
            <label className="text-xs text-white/40 block mb-1">API Key</label>
            <input
              type="password"
              value={currentForm.apiKey || ''}
              onChange={e => setForm({ ...currentForm, apiKey: e.target.value })}
              placeholder="sk-..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-tan/40 focus:outline-none"
            />
          </div>
        )}

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

        {/* 自定义 Base URL */}
        <div>
          <label className="text-xs text-white/40 block mb-1">API 地址（可选，留空用默认）</label>
          <input
            type="text"
            value={currentForm.baseUrl || ''}
            onChange={e => setForm({ ...currentForm, baseUrl: e.target.value })}
            placeholder="https://api.deepseek.com/v1"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-tan/40 focus:outline-none"
          />
        </div>

        {/* 启用开关 */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/60">启用 AI</span>
          <button
            onClick={() => setForm({ ...currentForm, enabled: !currentForm.enabled })}
            className={`w-10 h-5 rounded-full transition-colors ${currentForm.enabled ? 'bg-tan' : 'bg-white/10'}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white transition-transform ${currentForm.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => saveMutation.mutate(currentForm)}
            disabled={saveMutation.isPending}
            className="flex-1 bg-tan text-white py-2 rounded-lg text-sm active:scale-[0.97] disabled:opacity-50"
          >
            {saveMutation.isPending ? '保存中...' : '保存配置'}
          </button>
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="flex-1 glass-card py-2 text-center text-sm text-white/50 hover:text-white/80"
          >
            {testMutation.isPending ? '测试中...' : '测试连接'}
          </button>
        </div>

        {/* 测试结果 */}
        {testMutation.data && (
          <div className={`text-xs p-2 rounded ${testMutation.data.ok ? 'bg-moss/10 text-moss' : 'bg-cinnabar/10 text-cinnabar'}`}>
            {testMutation.data.ok ? `连接成功: ${testMutation.data.response}` : `失败: ${testMutation.data.error}`}
          </div>
        )}
        {saveMutation.isSuccess && (
          <div className="text-xs text-moss">配置已保存</div>
        )}
      </div>
    </div>
  )
}

// ── 对话面板 ─────────────────────────────────────────────
function AIChat() {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([])
  const [input, setInput] = useState('')

  const chatMutation = useMutation({
    mutationFn: (message: string) => post('/api/ai/chat', { message }),
    onSuccess: (data) => {
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
    },
    onError: (err: any) => {
      setMessages(prev => [...prev, { role: 'assistant', content: `错误: ${err.message}` }])
    },
  })

  const handleSend = () => {
    if (!input.trim()) return
    setMessages(prev => [...prev, { role: 'user', content: input }])
    chatMutation.mutate(input)
    setInput('')
  }

  return (
    <div className="glass-card flex flex-col h-[500px]">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-white/20 text-sm py-8">
            <Bot size={32} className="mx-auto mb-2 text-white/10" />
            试试问我：今天营收多少？哪个技师表现最好？
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
              msg.role === 'user'
                ? 'bg-tan/20 text-white/90'
                : 'bg-white/5 text-white/70'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {chatMutation.isPending && (
          <div className="flex justify-start">
            <div className="bg-white/5 px-3 py-2 rounded-xl text-sm text-white/40">思考中...</div>
          </div>
        )}
      </div>

      {/* 输入框 */}
      <div className="p-3 border-t border-white/5 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="问我任何经营问题..."
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-tan/40 focus:outline-none"
        />
        <button
          onClick={handleSend}
          disabled={chatMutation.isPending || !input.trim()}
          className="bg-tan text-white px-3 py-2 rounded-lg active:scale-[0.97] disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}

// ── 工具面板 ─────────────────────────────────────────────
function AITools() {
  const scoreMutation = useMutation({
    mutationFn: () => post('/api/ai/score-technicians'),
  })
  const reportMutation = useMutation({
    mutationFn: () => get('/api/ai/daily-report'),
  })

  return (
    <div className="space-y-3 max-w-lg">
      {/* 月度评分 */}
      <div className="glass-card p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium flex items-center gap-2">
            <Star size={14} className="text-tan" /> AI 技师月度评分
          </div>
          <div className="text-xs text-white/30 mt-0.5">分析本月所有评价，生成多维度评分</div>
        </div>
        <button
          onClick={() => scoreMutation.mutate()}
          disabled={scoreMutation.isPending}
          className="bg-tan text-white px-3 py-1.5 rounded-lg text-xs active:scale-[0.97] disabled:opacity-50"
        >
          {scoreMutation.isPending ? '评分中...' : '立即评分'}
        </button>
      </div>
      {scoreMutation.data && (
        <div className="glass-card p-3 text-xs space-y-1">
          {scoreMutation.data.results?.map((r: any) => (
            <div key={r.id || r.name} className="flex justify-between">
              <span>{r.name}</span>
              <span className="text-tan">{r.score ? `${r.score}分` : r.msg || r.error}</span>
            </div>
          ))}
        </div>
      )}

      {/* 经营日报 */}
      <div className="glass-card p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium flex items-center gap-2">
            <FileText size={14} className="text-moss" /> AI 经营日报
          </div>
          <div className="text-xs text-white/30 mt-0.5">AI 分析今日数据，生成经营建议</div>
        </div>
        <button
          onClick={() => reportMutation.mutate()}
          disabled={reportMutation.isPending}
          className="bg-moss/80 text-white px-3 py-1.5 rounded-lg text-xs active:scale-[0.97] disabled:opacity-50"
        >
          {reportMutation.isPending ? '生成中...' : '生成日报'}
        </button>
      </div>
      {reportMutation.data && (
        <div className="glass-card p-3 text-sm text-white/70 whitespace-pre-wrap">
          {reportMutation.data.report || reportMutation.data.error}
        </div>
      )}
    </div>
  )
}
