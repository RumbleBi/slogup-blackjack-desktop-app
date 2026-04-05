import { FormEvent, useState } from 'react'
import { notifyError } from '@renderer/lib/toast'

interface NicknameGateProps {
  onSubmit: (nickname: string) => Promise<void>
}

export function NicknameGate({ onSubmit }: NicknameGateProps): React.JSX.Element {
  const [nickname, setNickname] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    try {
      setSubmitting(true)
      await onSubmit(nickname)
    } catch (submitError) {
      notifyError(
        submitError instanceof Error ? submitError.message : '닉네임 저장에 실패했습니다.',
        'nickname-submit'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl rounded-3xl border border-white/20 bg-[rgba(11,20,18,0.8)] p-8 shadow-[0_28px_80px_rgba(0,0,0,0.45)] backdrop-blur-lg">
      <p className="text-sm uppercase tracking-[0.25em] text-emerald-300/80">
        Blackjack Lobby Entry
      </p>
      <h1 className="mt-3 font-display text-4xl text-slate-100">닉네임 설정</h1>
      <p className="mt-3 text-sm text-slate-300/80">앱에 입장하려면 2~20자 닉네임을 입력하세요.</p>

      <form className="mt-8 flex flex-col gap-4" onSubmit={handleSubmit}>
        <input
          className="rounded-2xl border border-emerald-200/30 bg-black/30 px-4 py-3 text-lg text-slate-100 outline-none transition focus:border-emerald-300"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="예: CardShark"
          minLength={2}
          maxLength={20}
          required
        />
        <button
          type="submit"
          className="rounded-2xl bg-emerald-300 px-4 py-3 font-semibold text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={submitting}
        >
          {submitting ? '저장 중...' : '입장하기'}
        </button>
      </form>
    </div>
  )
}
