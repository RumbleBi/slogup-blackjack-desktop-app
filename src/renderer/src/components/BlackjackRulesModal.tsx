interface BlackjackRulesModalProps {
  open: boolean
  onClose: () => void
}

export function BlackjackRulesModal({
  open,
  onClose
}: BlackjackRulesModalProps): React.JSX.Element | null {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/75 px-4">
      <div className="w-full max-w-3xl rounded-2xl border border-white/15 bg-[rgba(11,20,18,0.98)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-3xl text-slate-100">블랙잭 룰 안내</h3>
            <p className="mt-1 text-sm text-slate-300">
              처음 플레이하더라도 바로 이해할 수 있도록 핵심 규칙만 정리했습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/20 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
          >
            닫기
          </button>
        </div>

        <div className="mt-4 max-h-[68vh] space-y-4 overflow-y-auto pr-1 text-sm text-slate-200">
          <section className="rounded-xl border border-white/10 bg-black/20 p-4">
            <h4 className="font-semibold text-emerald-200">1. 기본 목표 (표준 블랙잭)</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
              <li>카드 합을 21에 가깝게 만들되, 21을 넘기면 즉시 Bust(패배)입니다.</li>
              <li>딜러보다 높은 점수면 승리, 동일 점수면 Push(무승부)입니다.</li>
              <li>A는 1 또는 11, J/Q/K는 10으로 계산됩니다.</li>
              <li>딜러는 17 이상에서 멈추고(Stand), 16 이하면 카드를 더 받습니다.</li>
              <li>처음 2장으로 21(블랙잭) 달성 시 배당은 +1.5배입니다.</li>
            </ul>
          </section>

          <section className="rounded-xl border border-white/10 bg-black/20 p-4">
            <h4 className="font-semibold text-emerald-200">2. 라운드 진행</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
              <li>게임 시작 시 방 설정의 기본 베팅 금액이 자동으로 적용됩니다.</li>
              <li>
                보유 금액이 기본 베팅보다 적으면 즉시 탈락 처리되며 현재 최하위 순위가 부여됩니다.
              </li>
              <li>플레이어 행동은 Hit / Stand / Double 3가지입니다.</li>
              <li>Double은 첫 2장 상태에서만 가능하며, 베팅 2배를 감당할 잔액이 있어야 합니다.</li>
              <li>라운드 종료 후 조건이 충족되면 다음 라운드는 자동으로 시작됩니다.</li>
            </ul>
          </section>

          <section className="rounded-xl border border-white/10 bg-black/20 p-4">
            <h4 className="font-semibold text-emerald-200">3. 블랙잭 승리 조건</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
              <li>방 생성 시 설정한 목표 금액(N$)에 먼저 도달하면 즉시 우승입니다.</li>
              <li>또는 마지막까지 잔액이 남아있는 플레이어 1명이 되면 우승입니다.</li>
              <li>잔액이 0 이하가 되면 탈락(eliminated) 처리됩니다.</li>
              <li>
                탈락 순서대로 하위 등수(예: 5th)가 확정되며, 최종 결과는 리더보드로 표시됩니다.
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-white/10 bg-black/20 p-4">
            <h4 className="font-semibold text-emerald-200">4. 연결/턴 시간 관련 규칙</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
              <li>플레이어가 30초 이상 연결 신호가 없으면 disconnected 처리됩니다.</li>
              <li>disconnected 플레이어는 해당 라운드에서 패배 처리(베팅 금액 손실)됩니다.</li>
              <li>내 턴에서 60초 동안 행동이 없으면 자동으로 Stand 처리됩니다.</li>
              <li>방장 연결이 30초 이상 끊기면 방은 즉시 종료되고 참가자는 로비로 이동됩니다.</li>
              <li>재입장은 마지막 연결 시점 기준 30초 이내일 때만 허용됩니다.</li>
            </ul>
          </section>

          <section className="rounded-xl border border-white/10 bg-black/20 p-4">
            <h4 className="font-semibold text-emerald-200">5. 시작 조건</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
              <li>방 인원은 1~5명이며, 1명이어도 딜러와 단독 플레이가 가능합니다.</li>
              <li>
                대기 상태에서 방장을 제외한 참가자 전원이 READY일 때 방장이 시작할 수 있습니다.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
