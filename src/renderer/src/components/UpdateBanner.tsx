import type { UpdateState } from '@renderer/app/useAutoUpdate'

interface UpdateBannerProps {
  state: UpdateState
}

export function UpdateBanner({ state }: UpdateBannerProps): React.JSX.Element {
  if (state.status === 'idle' || state.status === 'none') {
    return <div className="text-xs text-slate-400">{state.message}</div>
  }

  if (state.status === 'downloaded') {
    return (
      <button
        type="button"
        onClick={() => void window.api.installUpdateNow()}
        className="rounded-full border border-amber-200/40 bg-amber-100/20 px-3 py-1 text-xs text-amber-100 transition hover:bg-amber-100/30"
      >
        업데이트 준비 완료 - 재시작 설치
      </button>
    )
  }

  const tone = state.status === 'error' ? 'text-rose-300' : 'text-emerald-200'
  const detail = state.percent ? ` (${state.percent.toFixed(0)}%)` : ''

  return <div className={`text-xs ${tone}`}>{`${state.message}${detail}`}</div>
}
