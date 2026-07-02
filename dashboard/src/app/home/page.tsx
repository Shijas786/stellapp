'use client';

import React, { useEffect, useState } from 'react';
import styles from './page.module.css';

export default function DashboardHome() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const token = localStorage.getItem('stellapp_token');
    // If not logged in, redirect to login
    if (!token && window.location.pathname.includes('/dashboard/home')) {
      window.location.href = '/dashboard';
    }
  }, []);

  if (!isMounted) return null;

  return (
    <div className={styles.dashboardContainer}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <div className={styles.logoCircle}>S</div>
          <span className={styles.logoText}>Stellapp</span>
        </div>
        
        <nav className={styles.navMenu}>
          <div className={`${styles.navItem} ${styles.active}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            Overview
          </div>
          <div className={styles.navItem}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"></path></svg>
            Wallets
          </div>
          <div className={styles.navItem}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 17 12 21 16 17"></polyline><line x1="12" y1="12" x2="12" y2="21"></line><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"></path></svg>
            Transactions
          </div>
          <div className={styles.navItem}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            Contacts
          </div>
          <div className={styles.navItem} style={{ marginTop: 'auto' }} onClick={() => { localStorage.removeItem('stellapp_token'); window.location.href='/dashboard'; }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            <span>Log Out</span>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className={styles.mainContent}>
        <header className={styles.header}>
          <h1 className={styles.headerTitle}>Overview</h1>
          <div className={styles.userProfile}>
            <div className={styles.avatar}>+54</div>
          </div>
        </header>

        <div className={styles.dashboardGrid}>
          {/* Left Column */}
          <div className={styles.mainColumn}>
            <div className={styles.balanceCard}>
              <div className={styles.balanceCardBg}></div>
              <div className={styles.balanceContent}>
                <p className={styles.balanceLabel}>Total Balance</p>
                <div className={styles.balanceAmount}>
                  <span className={styles.balanceCurrency}>$</span>
                  1,245.50
                </div>
                
                <div className={styles.actionButtons}>
                  <button className={`${styles.actionBtn} ${styles.primary}`}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    Deposit
                  </button>
                  <button className={styles.actionBtn}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12 12 5 19 12"></polyline><line x1="12" y1="19" x2="12" y2="5"></line></svg>
                    Send
                  </button>
                  <button className={styles.actionBtn}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                    Swap
                  </button>
                </div>
              </div>
            </div>

            <div className={styles.recentTransactions}>
              <h3 className={styles.sectionTitle}>Recent Activity</h3>
              
              <div className={styles.transactionItem}>
                <div className={styles.txLeft}>
                  <div className={`${styles.txIcon} ${styles.green}`}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                  </div>
                  <div className={styles.txInfo}>
                    <h4>Received from Juan</h4>
                    <p>Today, 10:45 AM • January Payment</p>
                  </div>
                </div>
                <div className={`${styles.txAmount} ${styles.positive}`}>+$1,000.00</div>
              </div>

              <div className={styles.transactionItem}>
                <div className={styles.txLeft}>
                  <div className={`${styles.txIcon} ${styles.gray}`}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                  </div>
                  <div className={styles.txInfo}>
                    <h4>Sent to Pedro</h4>
                    <p>Yesterday, 8:20 PM • Dinner</p>
                  </div>
                </div>
                <div className={`${styles.txAmount} ${styles.negative}`}>-$15.00</div>
              </div>

              <div className={styles.transactionItem}>
                <div className={styles.txLeft}>
                  <div className={`${styles.txIcon} ${styles.orange}`}>₿</div>
                  <div className={styles.txInfo}>
                    <h4>Purchased BTC</h4>
                    <p>Jul 1, 2:15 PM • Uniswap V3</p>
                  </div>
                </div>
                <div className={`${styles.txAmount} ${styles.positive}`}>+0.00015 BTC</div>
              </div>
              
            </div>
          </div>

          {/* Right Column */}
          <div className={styles.sideColumn}>
            <div className={styles.marketWidget}>
              <h3 className={styles.sectionTitle}>Your Assets</h3>
              
              <div className={styles.assetItem}>
                <div className={styles.assetLeft}>
                  <div className={`${styles.assetIcon} ${styles.usdc}`}>$</div>
                  <div className={styles.assetInfo}>
                    <h4>USDC</h4>
                    <p>USD Coin</p>
                  </div>
                </div>
                <div className={styles.assetPrice}>
                  <h4>1,245.50</h4>
                  <p>$1.00</p>
                </div>
              </div>

              <div className={styles.assetItem}>
                <div className={styles.assetLeft}>
                  <div className={`${styles.assetIcon} ${styles.xlm}`}>X</div>
                  <div className={styles.assetInfo}>
                    <h4>XLM</h4>
                    <p>Stellar Lumens</p>
                  </div>
                </div>
                <div className={styles.assetPrice}>
                  <h4>0.00</h4>
                  <p className={styles.up}>$0.09</p>
                </div>
              </div>

            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
