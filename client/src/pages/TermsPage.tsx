import React from 'react';
import { useNavigate } from 'react-router-dom';

const TermsPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button
          type="button"
          style={styles.backButton}
          onClick={() => navigate(-1)}
        >
          ← 返回
        </button>
        <h1 style={styles.title}>用户协议与免责声明</h1>
      </div>

      <div style={styles.content}>
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>1. 服务说明</h2>
          <p style={styles.paragraph}>
            AI智能投资陪伴助手（以下简称"本服务"）是一款面向投资爱好者的<b>学习工具和辅助分析工具</b>，
            旨在为个人投资者提供市场数据展示、技术指标计算、AI分析参考等服务。
          </p>
          <p style={styles.paragraph}>
            本服务仅提供<b>分析参考和学习交流</b>，不提供投资咨询服务，不构成任何投资建议、推荐或指导。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>2. 用户责任</h2>
          <p style={styles.paragraph}>
            用户理解并同意：
          </p>
          <ul style={styles.list}>
            <li>所有投资决策由用户<b>独立做出，自行负责</b></li>
            <li>股市有风险，投资需谨慎，市场波动可能导致本金亏损</li>
            <li>本服务生成的所有分析结果、参考方案仅供学习参考，不保证准确性</li>
            <li>用户应基于自己的独立判断做出投资决策</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>3. 免责声明</h2>
          <p style={styles.paragraph}>
            <b>本服务不对用户的投资损益承担任何责任：</b>
          </p>
          <ul style={styles.list}>
            <li>AI分析结果可能存在错误，数据可能延迟或不准确</li>
            <li>历史表现不代表未来预期</li>
            <li>因系统故障、数据错误、网络问题导致的损失，本服务不承担责任</li>
            <li>用户因使用本服务产生的任何直接或间接损失，均由用户自行承担</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>4. 合规声明</h2>
          <p style={styles.paragraph}>
            本服务未取得证券投资咨询业务资质，<b>不从事任何投资咨询活动</b>：
          </p>
          <ul style={styles.list}>
            <li>所有输出均使用"参考方案"措辞，不使用"建议""推荐"等投资咨询性质措辞</li>
            <li>本服务不是证券公司，不提供开户、交易等证券业务</li>
            <li>不接受用户委托理财，不分成，不收取收益提成</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>5. 用户承诺</h2>
          <p style={styles.paragraph}>
            用户承诺：
          </p>
          <ul style={styles.list}>
            <li>仅将本服务用于个人学习和参考目的</li>
            <li>不会将本服务用于非法或违规用途</li>
            <li>不会以本服务的分析结果为由要求本服务承担任何投资损失</li>
            <li>理解并接受本服务的局限性，对分析结果保留独立判断</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>6. 数据隐私</h2>
          <p style={styles.paragraph}>
            本服务存储用户的持仓数据和对话记录，仅用于提供分析服务，不会泄露给第三方。
            用户可以随时删除自己的账户和数据。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>7. 条款修改</h2>
          <p style={styles.paragraph}>
            本服务有权随时修改本协议条款，修改后会在页面公示。用户继续使用本服务即视为接受修改后的条款。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>8. 法律管辖</h2>
          <p style={styles.paragraph}>
            本协议适用中华人民共和国法律管辖。如发生争议，应协商解决；协商不成的，提交服务提供者所在地法院诉讼解决。
          </p>
        </section>

        <div style={styles.disclaimerBox}>
          <p style={styles.disclaimerText}>
            <strong>再次提醒：股市有风险，投资需谨慎。所有分析仅供学习参考，不构成投资依据。投资决策请独立判断，盈亏自负。</strong>
          </p>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: '#f5f6fa',
    minHeight: '100%',
    paddingBottom: '40px',
  },
  header: {
    backgroundColor: '#fff',
    padding: '16px',
    borderBottom: '1px solid #e8e8e8',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#666',
    fontSize: '14px',
    cursor: 'pointer',
    padding: '4px 8px',
    marginBottom: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '32px',
  },
  title: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#333',
    margin: 0,
  },
  content: {
    padding: '16px',
    maxWidth: '800px',
    margin: '0 auto',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '20px 16px',
    marginBottom: '12px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#333',
    marginTop: 0,
    marginBottom: '12px',
  },
  paragraph: {
    fontSize: '14px',
    lineHeight: 1.7,
    color: '#555',
    margin: '8px 0',
  },
  list: {
    fontSize: '14px',
    lineHeight: 1.8,
    color: '#555',
    paddingLeft: '20px',
    margin: '8px 0',
  },
  disclaimerBox: {
    backgroundColor: '#fff3f3',
    border: '1px solid #ffcccc',
    borderRadius: '12px',
    padding: '16px',
    marginTop: '20px',
  },
  disclaimerText: {
    fontSize: '14px',
    lineHeight: 1.7,
    color: '#c53030',
    margin: 0,
    textAlign: 'center' as const,
  },
};

export default TermsPage;
