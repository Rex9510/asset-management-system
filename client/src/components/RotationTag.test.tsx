import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import RotationTag from './RotationTag';
import * as rotationApi from '../api/rotation';

jest.mock('../api/rotation');

const mockGetRotation = rotationApi.getRotationCurrent as jest.MockedFunction<typeof rotationApi.getRotationCurrent>;

describe('RotationTag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading placeholder initially', () => {
    mockGetRotation.mockReturnValue(new Promise(() => {}));
    render(<RotationTag />);
    expect(screen.getByTestId('rotation-loading')).toHaveTextContent('轮动计算中...');
  });

  it('hides when API fails', async () => {
    mockGetRotation.mockRejectedValue(new Error('Network error'));
    const { container } = render(<RotationTag />);
    await waitFor(() => {
      expect(screen.queryByTestId('rotation-loading')).not.toBeInTheDocument();
    });
    expect(container.innerHTML).toBe('');
  });

  it('hides when no phase data', async () => {
    mockGetRotation.mockResolvedValue({ currentPhase: null, message: '暂无轮动数据' });
    const { container } = render(<RotationTag />);
    await waitFor(() => {
      expect(screen.queryByTestId('rotation-loading')).not.toBeInTheDocument();
    });
    expect(container.innerHTML).toBe('');
  });

  it('renders P1 tag with purple color', async () => {
    mockGetRotation.mockResolvedValue({
      currentPhase: 'P1',
      phaseLabel: '科技成长',
      updatedAt: '2024-01-01T00:00:00Z',
    });
    render(<RotationTag />);
    await waitFor(() => {
      expect(screen.getByTestId('rotation-tag')).toBeInTheDocument();
    });
    const tag = screen.getByTestId('rotation-tag');
    expect(tag).toHaveTextContent('P1 科技成长 🔄');
    expect(tag).toHaveStyle({ color: '#6c9bff' });
  });

  it('renders P2 tag with orange color', async () => {
    mockGetRotation.mockResolvedValue({
      currentPhase: 'P2',
      phaseLabel: '周期品',
      updatedAt: '2024-01-01T00:00:00Z',
    });
    render(<RotationTag />);
    await waitFor(() => {
      expect(screen.getByTestId('rotation-tag')).toBeInTheDocument();
    });
    const tag = screen.getByTestId('rotation-tag');
    expect(tag).toHaveTextContent('P2 周期品 🔄');
    expect(tag).toHaveStyle({ color: '#ffa502' });
  });

  it('renders P3 tag with blue color', async () => {
    mockGetRotation.mockResolvedValue({
      currentPhase: 'P3',
      phaseLabel: '消费白酒',
      updatedAt: '2024-01-01T00:00:00Z',
    });
    render(<RotationTag />);
    await waitFor(() => {
      expect(screen.getByTestId('rotation-tag')).toBeInTheDocument();
    });
    const tag = screen.getByTestId('rotation-tag');
    expect(tag).toHaveTextContent('P3 消费白酒 🔄');
    expect(tag).toHaveStyle({ color: '#c39bdf' });
  });
});
