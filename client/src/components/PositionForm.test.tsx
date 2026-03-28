import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import PositionForm from './PositionForm';
import { Position } from '../api/positions';

jest.mock('../api/positions', () => ({
  createPosition: jest.fn(),
  updatePosition: jest.fn(),
  deletePosition: jest.fn(),
}));

const positionsApi = require('../api/positions') as {
  createPosition: jest.Mock;
  updatePosition: jest.Mock;
  deletePosition: jest.Mock;
};

const mockOnClose = jest.fn();
const mockOnSaved = jest.fn();

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 1, userId: 1, stockCode: '600000', stockName: '浦发银行',
    positionType: 'holding', costPrice: 10.5, shares: 1000, buyDate: '2024-06-01',
    currentPrice: 12.0, profitLoss: 1500, profitLossPercent: 14.29, holdingDays: 30,
    changePercent: null,
    createdAt: '2024-06-01T00:00:00Z', updatedAt: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  positionsApi.createPosition.mockResolvedValue(makePosition());
  positionsApi.updatePosition.mockResolvedValue(makePosition());
  positionsApi.deletePosition.mockResolvedValue(undefined);
});

describe('PositionForm - Add Mode', () => {
  it('renders add form with holding type by default', () => {
    render(<PositionForm position={null} onClose={mockOnClose} onSaved={mockOnSaved} />);
    expect(screen.getByLabelText('添加持仓')).toBeInTheDocument();
    expect(screen.getByLabelText('股票代码')).toBeInTheDocument();
    expect(screen.getByLabelText('股票名称')).toBeInTheDocument();
    expect(screen.getByLabelText('成本价')).toBeInTheDocument();
    expect(screen.getByLabelText('份额')).toBeInTheDocument();
    expect(screen.getByLabelText('买入时间')).toBeInTheDocument();
  });

  it('hides holding-specific fields when watching type selected', async () => {
    render(<PositionForm position={null} onClose={mockOnClose} onSaved={mockOnSaved} />);
    await userEvent.click(screen.getByText('关注'));
    expect(screen.queryByLabelText('成本价')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('份额')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('买入时间')).not.toBeInTheDocument();
  });

  it('shows validation errors for empty holding form', async () => {
    render(<PositionForm position={null} onClose={mockOnClose} onSaved={mockOnSaved} />);
    await userEvent.click(screen.getByText('添加'));
    expect(screen.getByText('请输入股票代码')).toBeInTheDocument();
    expect(screen.getByText('请输入股票名称')).toBeInTheDocument();
    expect(screen.getByText('请输入成本价')).toBeInTheDocument();
    expect(screen.getByText('请输入份额')).toBeInTheDocument();
    expect(screen.getByText('请输入买入时间')).toBeInTheDocument();
  });

  it('validates stock code format (A-share 6 digits)', async () => {
    render(<PositionForm position={null} onClose={mockOnClose} onSaved={mockOnSaved} />);
    await userEvent.type(screen.getByLabelText('股票代码'), '12345');
    await userEvent.type(screen.getByLabelText('股票名称'), '测试');
    await userEvent.type(screen.getByLabelText('成本价'), '10');
    await userEvent.type(screen.getByLabelText('份额'), '100');
    fireEvent.change(screen.getByLabelText('买入时间'), { target: { value: '2024-01-01' } });
    await userEvent.click(screen.getByText('添加'));
    expect(screen.getByText('股票代码无效，请输入6位A股代码（0/3/6开头）')).toBeInTheDocument();
  });

  it('validates cost price must be positive', async () => {
    render(<PositionForm position={null} onClose={mockOnClose} onSaved={mockOnSaved} />);
    await userEvent.type(screen.getByLabelText('股票代码'), '600000');
    await userEvent.type(screen.getByLabelText('股票名称'), '浦发银行');
    await userEvent.type(screen.getByLabelText('成本价'), '-5');
    await userEvent.type(screen.getByLabelText('份额'), '100');
    fireEvent.change(screen.getByLabelText('买入时间'), { target: { value: '2024-01-01' } });
    await userEvent.click(screen.getByText('添加'));
    expect(screen.getByText('成本价必须为正数')).toBeInTheDocument();
  });

  it('validates shares must be positive integer', async () => {
    render(<PositionForm position={null} onClose={mockOnClose} onSaved={mockOnSaved} />);
    await userEvent.type(screen.getByLabelText('股票代码'), '600000');
    await userEvent.type(screen.getByLabelText('股票名称'), '浦发银行');
    await userEvent.type(screen.getByLabelText('成本价'), '10');
    await userEvent.type(screen.getByLabelText('份额'), '10.5');
    fireEvent.change(screen.getByLabelText('买入时间'), { target: { value: '2024-01-01' } });
    await userEvent.click(screen.getByText('添加'));
    expect(screen.getByText('份额必须为正整数')).toBeInTheDocument();
  });

  it('submits valid holding form and calls onSaved', async () => {
    render(<PositionForm position={null} onClose={mockOnClose} onSaved={mockOnSaved} />);
    await userEvent.type(screen.getByLabelText('股票代码'), '600000');
    await userEvent.type(screen.getByLabelText('股票名称'), '浦发银行');
    await userEvent.type(screen.getByLabelText('成本价'), '10.5');
    await userEvent.type(screen.getByLabelText('份额'), '1000');
    fireEvent.change(screen.getByLabelText('买入时间'), { target: { value: '2024-01-01' } });
    await userEvent.click(screen.getByText('添加'));

    await waitFor(() => {
      expect(positionsApi.createPosition).toHaveBeenCalledWith({
        stockCode: '600000',
        stockName: '浦发银行',
        positionType: 'holding',
        costPrice: 10.5,
        shares: 1000,
        buyDate: '2024-01-01',
      });
      expect(mockOnSaved).toHaveBeenCalled();
    });
  });

  it('submits valid watching form (only code and name)', async () => {
    render(<PositionForm position={null} defaultType="watching" onClose={mockOnClose} onSaved={mockOnSaved} />);
    await userEvent.type(screen.getByLabelText('股票代码'), '000001');
    await userEvent.type(screen.getByLabelText('股票名称'), '平安银行');
    await userEvent.click(screen.getByText('添加'));

    await waitFor(() => {
      expect(positionsApi.createPosition).toHaveBeenCalledWith({
        stockCode: '000001',
        stockName: '平安银行',
        positionType: 'watching',
      });
      expect(mockOnSaved).toHaveBeenCalled();
    });
  });

  it('calls onClose when close button clicked', async () => {
    render(<PositionForm position={null} onClose={mockOnClose} onSaved={mockOnSaved} />);
    await userEvent.click(screen.getByLabelText('关闭'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when cancel button clicked', async () => {
    render(<PositionForm position={null} onClose={mockOnClose} onSaved={mockOnSaved} />);
    await userEvent.click(screen.getByText('取消'));
    expect(mockOnClose).toHaveBeenCalled();
  });
});

describe('PositionForm - Edit Mode', () => {
  it('renders edit form with pre-filled values', () => {
    const pos = makePosition();
    render(<PositionForm position={pos} onClose={mockOnClose} onSaved={mockOnSaved} />);
    expect(screen.getByLabelText('编辑持仓')).toBeInTheDocument();
    // Stock code/name inputs should not be shown in edit mode
    expect(screen.queryByLabelText('股票代码')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('股票名称')).not.toBeInTheDocument();
    // Holding fields should be pre-filled
    expect(screen.getByLabelText('成本价')).toHaveValue('10.5');
    expect(screen.getByLabelText('份额')).toHaveValue('1000');
  });

  it('submits edit form and calls updatePosition', async () => {
    const pos = makePosition();
    render(<PositionForm position={pos} onClose={mockOnClose} onSaved={mockOnSaved} />);
    const costInput = screen.getByLabelText('成本价');
    await userEvent.clear(costInput);
    await userEvent.type(costInput, '12');
    await userEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(positionsApi.updatePosition).toHaveBeenCalledWith(1, {
        costPrice: 12,
        shares: 1000,
      });
      expect(mockOnSaved).toHaveBeenCalled();
    });
  });

  it('shows delete button in edit mode', () => {
    const pos = makePosition();
    render(<PositionForm position={pos} onClose={mockOnClose} onSaved={mockOnSaved} />);
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('shows delete confirmation dialog and deletes on confirm', async () => {
    const pos = makePosition();
    render(<PositionForm position={pos} onClose={mockOnClose} onSaved={mockOnSaved} />);
    await userEvent.click(screen.getByText('删除'));
    expect(screen.getByText(/确定要删除持仓 "浦发银行" 吗？/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('确认删除'));

    await waitFor(() => {
      expect(positionsApi.deletePosition).toHaveBeenCalledWith(1);
      expect(mockOnSaved).toHaveBeenCalled();
    });
  });

  it('cancels delete confirmation', async () => {
    const pos = makePosition();
    render(<PositionForm position={pos} onClose={mockOnClose} onSaved={mockOnSaved} />);
    await userEvent.click(screen.getByText('删除'));
    expect(screen.getByText(/确定要删除/)).toBeInTheDocument();
    // Click cancel in the confirm dialog
    const cancelButtons = screen.getAllByText('取消');
    await userEvent.click(cancelButtons[cancelButtons.length - 1]);
    expect(positionsApi.deletePosition).not.toHaveBeenCalled();
  });
});

describe('PositionForm - Watching Edit Mode', () => {
  it('does not show holding fields for watching position', () => {
    const pos = makePosition({
      positionType: 'watching',
      costPrice: null,
      shares: null,
      buyDate: null,
    });
    render(<PositionForm position={pos} onClose={mockOnClose} onSaved={mockOnSaved} />);
    expect(screen.queryByLabelText('成本价')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('份额')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('买入时间')).not.toBeInTheDocument();
  });
});
