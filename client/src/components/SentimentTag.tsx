import React, { useEffect, useState } from 'react';
import { getSentimentCurrent, SentimentData } from '../api/sentiment';
import SentimentGauge from './SentimentGauge';

const SentimentTag: React.FC = () => {
  const [data, setData] = useState<SentimentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getSentimentCurrent()
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <span style={styles.placeholder} data-testid="sentiment-loading">情绪计算中...</span>;
  }
  if (error || !data || data.score === null) return null;

  const getTagColor = (score: number): { color: string; bg: string } => {
    if (score < 25) return { color: '#ff4757', bg: 'rgba(255,71,87,0.2)' };
    if (score < 45) return { color: '#ffa502', bg: 'rgba(255,165,2,0.2)' };
    if (score < 55) return { color: '#c39bdf', bg: 'rgba(155,89,182,0.2)' };
    if (score < 75) return { color: '#2ed573', bg: 'rgba(46,213,115,0.2)' };
    return { color: '#13c2c2', bg: 'rgba(19,194,194,0.2)' };
  };

  const { color, bg } = getTagColor(data.score);

  const handleTagClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowModal(!showModal);
  };

  return (
    <>
      <span
        style={{ ...styles.tag, color, background: bg }}
        onClick={handleTagClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowModal(!showModal); }}
        data-testid="sentiment-tag"
      >
        {data.emoji} 情绪{data.score} ›
      </span>
      {showModal && data && (
        <SentimentGauge data={data} onClose={() => setShowModal(false)} />
      )}
    </>
  );
};

const styles: Record<string, React.CSSProperties> = {
  tag: {
    fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '10px',
    lineHeight: '16px', whiteSpace: 'nowrap', display: 'inline-flex',
    alignItems: 'center', gap: '2px', cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  placeholder: {
    fontSize: '10px', color: '#aaa', padding: '3px 8px', borderRadius: '10px',
    background: 'rgba(155,155,155,0.15)', lineHeight: '16px', whiteSpace: 'nowrap',
  },
};

export default SentimentTag;
