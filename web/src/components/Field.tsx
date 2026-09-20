interface FieldProps {
  label: string
  value: string
  onChange?: (v: string) => void
  type?: string
  placeholder?: string
  required?: boolean
}

export function Field({ label, value, onChange, type = 'text', placeholder, required }: FieldProps) {
  return (
    <div>
    <label className="block text-xs text-white/40 mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-tan/50"
    />
    </div>
  )
}