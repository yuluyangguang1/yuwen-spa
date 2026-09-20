import { memo } from 'react'
import { Bell } from 'lucide-react'
import { statusLabel } from '@/lib/utils'

interface TechCardProps {
  tech: any
  onClick: (tech: any) => void
}

export const TechCard = memo(function TechCard({ tech, onClick }: TechCardProps) {
  return (
    <tr
      className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] cursor-pointer"
      onClick={() => onClick(tech)}
    >
      <td className="p-3 font-bold text-white/60">{tech.number}</td>
      <td className="p-3">{tech.name}</td>
      <td className="p-3 text-white/50">{tech.level || '-'}</td>
      <td className="p-3 text-white/40">{tech.phone || '-'}</td>
      <td className="p-3 text-center">
        {tech.webhook_url ? <Bell size={14} className="text-tan mx-auto" /> : <span className="text-white/20 text-xs">-</span>}
      </td>
      <td className="p-3 text-center">
        <span className={`text-xs px-2 py-0.5 rounded ${
          tech.status === 'working' ? 'bg-tan/15 text-tan' :
          tech.status === 'idle' ? 'bg-moss/15 text-moss' :
          'bg-white/5 text-white/30'
        }`}>{statusLabel(tech.status)}</span>
      </td>
    </tr>
  )
})
