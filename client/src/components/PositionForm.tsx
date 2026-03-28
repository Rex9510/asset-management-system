import React, { useState, useEffect } from 'react';
import {
  Position,
  CreatePositionData,
  UpdatePositionData,
  createPosition,
  updatePosition,
  deletePosition,
} from '../api/positions';
import { setStopLoss as setStopLossApi } from '../api/stoploss';

export interface PositionFormProps {
  /** null = add mode, Position = edit mode */
  position: Position | null;
  /** Pre-selected position type for add mode */
  defaultType?: 'holding' | 'watching';
  onClose: () => void;
  onSaved: () => void;
}

interface FormErrors {
  stockCode?: string;
  stockName?: string;
  costPrice?: string;
  shares?: string;
  buyDate?: string;
}

const STOCK_CODE_REGEX = /^[036]\d{5}$/;

function validateStockCode(code: string): string | undefined {
  if (!code.trim()) return '请输入股票代码';
  if (!STOCK_CODE_REGEX.test(code.trim())) return '股票代码无效，请输入6位A股代码（0/3/6开头）';
  return undefined;
}

function validateStockName(name: string): string | undefined {
  if (!name.trim()) return '请输入股票名称';
  return undefined;
}

function validateCostPrice(value: string): string | undefined {
  if (!value.trim()) return '请输入成本价';
  const num = Number(value);
  if (isNaN(num) || num <= 0) return '成本价必须为正数';
  return undefined;
}

function validateShares(value: string): string | undefined {
  if (!value.trim()) return '请输入份额';
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return '份额必须为正整数';
  return undefined;
}

function validateBuyDate(value: string): string | undefined {
  if (!value.trim()) return '请输入买入时间';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '请输入有效日期';
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (date > today) return '买入时间不能是未来日期';
  return undefined;
}

const PositionForm: React.FC<PositionFormProps> = ({
  position,
  defaultType = 'holding',
  onClose,
  onSaved,
}) => {
  const isEdit = position !== null;

  const [positionType, setPositionType] = useState<'holding' | 'watching'>(
    position?.positionType ?? defaultType
  );
  const [stockCode, setStockCode] = useState(position?.stockCode ?? '');
  const [stockName, setStockName] = useState(position?.stockName ?? '');
  const [costPrice, setCostPrice] = useState(
    position?.costPrice != null ? String(position.costPrice) : ''
  );
  const [shares, setShares] = useState(
    position?.shares != null ? String(position.shares) : ''
  );
  const [buyDate, setBuyDate] = useState(position?.buyDate ?? '');
  const [stopLossPrice, setStopLossPrice] = useState(
    position?.stopLossPrice != null ? String(position.stopLossPrice) : ''
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (position) {
      setPositionType(position.positionType);
      setStockCode(position.stockCode);
      setStockName(position.stockName);
      setCostPrice(position.costPrice != null ? String(position.costPrice) : '');
      setShares(position.shares != null ? String(position.shares) : '');
      setBuyDate(position.buyDate ?? '');
      setStopLossPrice(position.stopLossPrice != null ? String(position.stopLossPrice) : '');
    }
  }, [position]);

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!isEdit) {
      errs.stockCode = validateStockCode(stockCode);
      errs.stockName = validateStockName(stockName);
    }
    if (positionType === 'holding') {
      errs.costPrice = validateCostPrice(costPrice);
      errs.shares = validateShares(shares);
      errs.buyDate = validateBuyDate(buyDate);
    }
    // Remove undefined entries
    Object.keys(errs).forEach((k) => {
      if (errs[k as keyof FormErrors] === undefined) delete errs[k as keyof FormErrors];
    });
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      if (isEdit) {
        const data: UpdatePositionData = {};
        if (positionType === 'holding') {
          data.costPrice = Number(costPrice);
          data.shares = Number(shares);
        }
        await updatePosition(position!.id, data);
        // Set stop loss if provided
        if (positionType === 'holding' && stopLossPrice.trim()) {
          try {
            await setStopLossApi(position!.id, Number(stopLossPrice));
          } catch {
            // Stop loss setting failure is non-blocking
          }
        }
      } else {
        const data: CreatePositionData = {
          stockCode: stockCode.trim(),
          stockName: stockName.trim(),
          positionType,
        };
        if (positionType === 'holding') {
          data.costPrice = Number(costPrice);
          data.shares = Number(shares);
          data.buyDate = buyDate;
        }
        const created = await createPosition(data);
        // Set stop loss if provided
        if (positionType === 'holding' && stopLossPrice.trim()) {
          try {
            await setStopLossApi(created.id, Number(stopLossPrice));
          } catch {
            // Stop loss setting failure is non-blocking
          }
        }
      }
      onSaved();
    } catch {
      // Error handled by API interceptor
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!position) return;
    setSubmitting(true);
    try {
      await deletePosition(position.id);
      onSaved();
    } catch {
      // Error handled by API interceptor
    } finally {
      setSubmitting(false);
      setShowDeleteConfirm(false);
    }
  }

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label={isEdit ? '编辑持仓' : '添加持仓'}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <span style={styles.title}>{isEdit ? '编辑持仓' : '添加持仓'}</span>
          <button type="button" style={styles.closeBtn} onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* Position type selector - only in add mode */}
          {!isEdit && (
            <div style={styles.typeSelector}>
              <button
                type="button"
                style={{
                  ...styles.typeBtn,
                  ...(positionType === 'holding' ? styles.typeBtnActive : {}),
                }}
                onClick={() => setPositionType('holding')}
              >
                持仓
              </button>
              <button
                type="button"
                style={{
                  ...styles.typeBtn,
                  ...(positionType === 'watching' ? styles.typeBtnActive : {}),
                }}
                onClick={() => setPositionType('watching')}
              >
                关注
              </button>
            </div>
          )}

          {/* Stock code & name - only in add mode */}
          {!isEdit && (
            <>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="pf-stockCode">股票代码</label>
                <input
                  id="pf-stockCode"
                  style={styles.input}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="如 600000"
                  value={stockCode}
                  onChange={(e) => setStockCode(e.target.value)}
                />
                {errors.stockCode && <span style={styles.error}>{errors.stockCode}</span>}
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="pf-stockName">股票名称</label>
                <input
                  id="pf-stockName"
                  style={styles.input}
                  type="text"
                  placeholder="如 浦发银行"
                  value={stockName}
                  onChange={(e) => setStockName(e.target.value)}
                />
                {errors.stockName && <span style={styles.error}>{errors.stockName}</span>}
              </div>
            </>
          )}

          {/* Holding-specific fields */}
          {positionType === 'holding' && (
            <>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="pf-costPrice">成本价</label>
                <input
                  id="pf-costPrice"
                  style={styles.input}
                  type="text"
                  inputMode="decimal"
                  placeholder="如 10.50"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                />
                {errors.costPrice && <span style={styles.error}>{errors.costPrice}</span>}
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="pf-shares">份额</label>
                <input
                  id="pf-shares"
                  style={styles.input}
                  type="text"
                  inputMode="numeric"
                  placeholder="如 1000"
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                />
                {errors.shares && <span style={styles.error}>{errors.shares}</span>}
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="pf-buyDate">买入时间</label>
                <input
                  id="pf-buyDate"
                  style={styles.input}
                  type="date"
                  value={buyDate}
                  onChange={(e) => setBuyDate(e.target.value)}
                />
                {errors.buyDate && <span style={styles.error}>{errors.buyDate}</span>}
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="pf-stopLoss">止损价（可选）</label>
                <input
                  id="pf-stopLoss"
                  style={styles.input}
                  type="text"
                  inputMode="decimal"
                  placeholder="如 9.00"
                  value={stopLossPrice}
                  onChange={(e) => setStopLossPrice(e.target.value)}
                />
              </div>
            </>
          )}

          <div style={styles.actions}>
            {isEdit && (
              <button
                type="button"
                style={styles.deleteBtn}
                onClick={() => setShowDeleteConfirm(true)}
                disabled={submitting}
              >
                删除
              </button>
            )}
            <button type="button" style={styles.cancelBtn} onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button type="submit" style={styles.submitBtn} disabled={submitting}>
              {submitting ? '提交中...' : isEdit ? '保存' : '添加'}
            </button>
          </div>
        </form>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div style={styles.confirmOverlay} role="alertdialog" aria-modal="true" aria-label="确认删除">
          <div style={styles.confirmBox}>
            <p style={styles.confirmText}>
              确定要删除{position?.positionType === 'holding' ? '持仓' : '关注'} "{position?.stockName}" 吗？
            </p>
            <div style={styles.confirmActions}>
              <button
                type="button"
                style={styles.cancelBtn}
                onClick={() => setShowDeleteConfirm(false)}
                disabled={submitting}
              >
                取消
              </button>
              <button
                type="button"
                style={styles.confirmDeleteBtn}
                onClick={handleDelete}
                disabled={submitting}
              >
                {submitting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.45)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff',
    borderRadius: '20px 20px 0 0',
    width: '100%',
    maxWidth: '428px',
    maxHeight: '85vh',
    overflowY: 'auto',
    padding: '24px 18px 80px',
    boxShadow: '0 -10px 40px rgba(0,0,0,0.1)',
    animation: 'slideUp 0.3s ease',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '18px',
  },
  title: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#1a1a2e',
  },
  closeBtn: {
    width: '44px',
    height: '44px',
    border: 'none',
    background: '#f8f9fc',
    fontSize: '16px',
    color: '#8b8fa3',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '12px',
  },
  typeSelector: {
    display: 'flex',
    gap: '0',
    marginBottom: '18px',
    background: '#f0f2f5',
    borderRadius: '12px',
    padding: '3px',
  },
  typeBtn: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    background: 'transparent',
    fontSize: '14px',
    fontWeight: 500,
    color: '#8b8fa3',
    cursor: 'pointer',
    borderRadius: '10px',
    minHeight: '44px',
    transition: 'all 0.25s ease',
  },
  typeBtnActive: {
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    color: '#fff',
    fontWeight: 600,
    boxShadow: '0 4px 12px rgba(102,126,234,0.3)',
  },
  field: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    color: '#555',
    marginBottom: '6px',
    fontWeight: 500,
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    border: '1px solid #e0e3ea',
    borderRadius: '12px',
    fontSize: '15px',
    color: '#1a1a2e',
    outline: 'none',
    boxSizing: 'border-box' as const,
    minHeight: '44px',
    background: '#f8f9fc',
    transition: 'all 0.2s ease',
  },
  error: {
    display: 'block',
    fontSize: '12px',
    color: '#ff4d4f',
    marginTop: '4px',
  },
  actions: {
    display: 'flex',
    gap: '10px',
    marginTop: '24px',
  },
  cancelBtn: {
    flex: 1,
    padding: '12px 0',
    border: '1px solid #e0e3ea',
    background: '#fff',
    borderRadius: '12px',
    fontSize: '15px',
    color: '#666',
    cursor: 'pointer',
    minHeight: '44px',
    fontWeight: 500,
  },
  submitBtn: {
    flex: 2,
    padding: '12px 0',
    border: 'none',
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: 600,
    color: '#fff',
    cursor: 'pointer',
    minHeight: '44px',
    boxShadow: '0 4px 12px rgba(102,126,234,0.3)',
  },
  deleteBtn: {
    flex: 1,
    padding: '12px 0',
    border: '1px solid #ff4d4f',
    background: '#fff',
    borderRadius: '12px',
    fontSize: '15px',
    color: '#ff4d4f',
    cursor: 'pointer',
    minHeight: '44px',
    fontWeight: 500,
  },
  confirmOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1100,
  },
  confirmBox: {
    background: '#fff',
    borderRadius: '16px',
    padding: '28px 22px',
    width: '80%',
    maxWidth: '320px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
  },
  confirmText: {
    fontSize: '15px',
    color: '#1a1a2e',
    textAlign: 'center' as const,
    marginBottom: '22px',
    lineHeight: '1.6',
  },
  confirmActions: {
    display: 'flex',
    gap: '10px',
  },
  confirmDeleteBtn: {
    flex: 1,
    padding: '12px 0',
    border: 'none',
    background: 'linear-gradient(135deg, #ff6b6b, #ee5a24)',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: 600,
    color: '#fff',
    cursor: 'pointer',
    minHeight: '44px',
    boxShadow: '0 4px 12px rgba(238,90,36,0.3)',
  },
};

export default PositionForm;
