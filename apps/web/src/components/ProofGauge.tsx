import type { CSSProperties } from 'react';
export default function ProofGauge({ score = 0, level = '—' }: {score?: number; level?: string}) {
  return <div className="proof-gauge">
    <div className="proof-ring" style={{'--score': `${score * 3.6}deg`} as CSSProperties}><strong>{score}</strong></div>
    <div><span>Confiança da prova</span><b>{level}</b></div>
  </div>;
}
