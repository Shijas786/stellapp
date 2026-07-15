'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  LogOut, Shield, RefreshCw, Send, DollarSign, 
  Wallet, User, Phone, CheckCircle, Clock, Link as LinkIcon 
} from 'lucide-react';
import './dashboard.css';

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userPhone, setUserPhone] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);

  // Sample static data showing beautiful placeholder dashboard details
  const [balances] = useState({
    xlm: '48.95',
    usdc: '250.00',
    totalUsd: '254.89'
  });

  const [transactions] = useState([
    { id: 1, type: 'send', amount: '10.00 USDC', status: 'success', recipient: 'Amal', date: 'Jul 14, 2026' },
    { id: 2, type: 'receive', amount: '50.00 USDC', status: 'success', sender: 'Grace', date: 'Jul 12, 2026' },
    { id: 3, type: 'swap', amount: '20.00 XLM → USDC', status: 'success', date: 'Jul 10, 2026' },
    { id: 4, type: 'deposit_pool', amount: '5.00 USDC', status: 'success', date: 'Jul 08, 2026' }
  ]);

  const stellarPublicAddress = 'GBCQW7N2EAWP5F3DPHHFLWR46W5V4QUSNPA7M2X4LU5BFF5N3P3AQH2S';

  useEffect(() => {
    // Check local authentication
    const token = localStorage.getItem('stellapp_token');
    const phone = localStorage.getItem('stellapp_phone');
    if (!token) {
      router.push('/login');
    } else {
      setUserPhone(phone || 'Stellapp User');
      setLoading(false);
    }
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('stellapp_token');
    localStorage.removeItem('stellapp_phone');
    router.push('/login');
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(stellarPublicAddress);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  if (loading) {
    return (
      <div className="dashboard-loading-container">
        <div className="loader"></div>
        <p>Verifying secure Stellapp credentials...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <aside className="dashboard-sidebar">
        <div className="logo-container">
          <div className="logo-icon">S</div>
          <span className="logo-text">Stellapp</span>
        </div>

        <nav className="sidebar-nav">
          <a href="#" className="nav-item active">
            <Wallet size={18} />
            My Wallet
          </a>
          <a href="#" className="nav-item">
            <Shield size={18} />
            Privacy Pools
          </a>
          <a href="/dashboard/roadmap" className="nav-item">
            <LinkIcon size={18} />
            Roadmap
          </a>
        </nav>

        <div className="sidebar-footer">
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Panel */}
      <main className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <h1>Overview</h1>
            <p className="header-subtitle">Welcome back, {userPhone}</p>
          </div>
          <div className="network-badge">
            <span className="status-dot"></span>
            Stellar Testnet
          </div>
        </header>

        {/* Hero Balance Card */}
        <section className="balance-hero-section">
          <div className="balance-hero-card">
            <h3>Estimated Net Worth</h3>
            <div className="main-balance">
              ${balances.totalUsd}
              <span className="currency-unit">USD</span>
            </div>
            <p className="balance-meta">Shielded on-chain asset value tracking</p>
          </div>
        </section>

        {/* Assets Section */}
        <section className="dashboard-section">
          <h2 className="section-title">My Assets</h2>
          <div className="asset-grid">
            {/* XLM Card */}
            <div className="asset-card">
              <div className="asset-header">
                <div className="asset-icon xlm">☄</div>
                <div>
                  <h4>Stellar Lumens</h4>
                  <span className="asset-code">XLM</span>
                </div>
              </div>
              <div className="asset-body">
                <div className="asset-amount">{balances.xlm}</div>
                <div className="asset-usd">≈ $4.89 USD</div>
              </div>
            </div>

            {/* USDC Card */}
            <div className="asset-card">
              <div className="asset-header">
                <div className="asset-icon usdc">$</div>
                <div>
                  <h4>USD Coin</h4>
                  <span className="asset-code">USDC</span>
                </div>
              </div>
              <div className="asset-body">
                <div className="asset-amount">{balances.usdc}</div>
                <div className="asset-usd">≈ $250.00 USD</div>
              </div>
            </div>
          </div>
        </section>

        {/* Details Grid */}
        <div className="info-grid">
          {/* Recent Activity */}
          <div className="info-card">
            <h3 className="card-title">Recent Activity</h3>
            <div className="contacts-list">
              {transactions.map((tx) => (
                <div key={tx.id} className="contact-item">
                  <div className="contact-avatar" style={{ background: tx.type === 'send' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 250, 154, 0.1)', color: tx.type === 'send' ? '#ef4444' : '#00fa9a' }}>
                    {tx.type === 'send' ? '↑' : tx.type === 'receive' ? '↓' : '⇄'}
                  </div>
                  <div className="contact-details" style={{ flex: 1 }}>
                    <h4>
                      {tx.type === 'send' 
                        ? `Sent to ${tx.recipient}` 
                        : tx.type === 'receive' 
                        ? `Received from ${tx.sender}` 
                        : tx.type === 'swap' 
                        ? 'Token Swap Executed' 
                        : 'ZK Pool Deposit'}
                    </h4>
                    <p>{tx.date} · {tx.status.toUpperCase()}</p>
                  </div>
                  <div style={{ fontWeight: 'bold', color: tx.type === 'send' ? '#ef4444' : '#00fa9a' }}>
                    {tx.type === 'send' ? '-' : '+'}{tx.amount.split(' ')[0]}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Account Details */}
          <div className="info-card">
            <h3 className="card-title">Wallet Address</h3>
            <div className="key-group">
              <label>Public Address</label>
              <div className="key-display-copy">
                <code>{stellarPublicAddress}</code>
                <button className="copy-btn" onClick={handleCopy}>
                  {copySuccess ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            
            <div className="key-group" style={{ marginTop: '20px' }}>
              <label>Connected Channel</label>
              <div className="key-display highlight-text">
                WhatsApp Messenger Client
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
