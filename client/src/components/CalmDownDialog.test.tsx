import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CalmDownDialog from './CalmDownDialog';
import { CalmDownEvaluation } from '../api/chat';

const rationalEval: CalmDownEvaluation = {
  buyLogicReview: '当初买入是因为技术面看好',
  sellJudgment: 'rational',
  worstCaseEstimate: '最坏情况下跌10%',
  recommendation: '参考方案：可以分批减仓',
};

const emotionalEval: CalmDownEvaluation = {
  buyLogicReview: '买入逻辑是长期持有',
  sellJudgment: 'emotional',
  worstCaseEstimate: '最坏情况下跌20%',
  recommendation: '参考方案：冷静后再决定',
};

describe('CalmDownDialog', () => {
  it('renders dialog with all evaluation sections', () => {
    render(<CalmDownDialog evaluation={rationalEval} onClose={jest.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('冷静一下')).toBeInTheDocument();
    expect(screen.getByText('当初买入是因为技术面看好')).toBeInTheDocument();
    expect(screen.getByText('最坏情况下跌10%')).toBeInTheDocument();
    expect(screen.getByText('参考方案：可以分批减仓')).toBeInTheDocument();
  });

  it('shows rational judgment badge for rational sell', () => {
    render(<CalmDownDialog evaluation={rationalEval} onClose={jest.fn()} />);
    expect(screen.getByText('✅ 理性卖出')).toBeInTheDocument();
  });

  it('shows emotional judgment badge for emotional sell', () => {
    render(<CalmDownDialog evaluation={emotionalEval} onClose={jest.fn()} />);
    expect(screen.getByText('⚠️ 情绪卖出')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = jest.fn();
    render(<CalmDownDialog evaluation={rationalEval} onClose={onClose} />);

    fireEvent.click(screen.getByText('我已了解，继续操作'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('displays disclaimer text', () => {
    render(<CalmDownDialog evaluation={rationalEval} onClose={jest.fn()} />);
    expect(screen.getByText('仅供参考，不构成投资依据')).toBeInTheDocument();
  });
});
