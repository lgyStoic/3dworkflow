// ==========================================
// 通用 UI 组件
// ==========================================

function StepControl({ active, completed, title, icon, children }) {
  return (
    <div className={`p-5 rounded-[2rem] border transition-all duration-300 ${active ? 'bg-white border-blue-200 shadow-xl scale-[1.01]' : 'bg-white/60 border-slate-100 opacity-80'}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm ${active ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
          {completed ? <CheckCircle2 size={16}/> : (active ? <Zap size={16}/> : <Box size={16}/>)}
        </div>
        <div className="flex-1 font-bold text-slate-800 text-sm">{title}</div>
      </div>
      {active && <div className="animate-in fade-in slide-in-from-top-2">{children}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step=1, onChange }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-slate-400"><span>{label}</span><span className="font-mono text-blue-400">{value}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))} className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
    </div>
  );
}
