'use client';

import React from 'react';
import Link from 'next/link';
import PillNav from '../../components/PillNav';
import BlurText from '../../components/BlurText';
import '../landing.css';

interface RoadmapItem {
  quarter: string;
  priority: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  status: 'completed' | 'active' | 'upcoming';
  points: string[];
  isHighlight?: boolean;
}

export default function RoadmapPage() {
  const navItems = [
    { label: 'Roadmap', href: '/roadmap' },
    { label: 'Connect', href: 'https://wa.me/917012751478?text=create%20wallet' }
  ];
  const items: RoadmapItem[] = [
    {
      quarter: 'Q2 2026',
      priority: 'Phase 1',
      title: 'StellApp Core features',
      status: 'completed',
      description: 'Initial production release on Stellar Testnet featuring secure wallet management, automated swaps, smart contract compiling, and zero-knowledge privacy features.',
      points: [
        'Stellar Testnet Wallets & DCA',
        'Soroban Compiler & Deployer',
        'ZK Shielded Confidential Transfers'
      ],
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2"></rect>
          <path d="M12 2L3 7v4h18V7L12 2z"></path>
        </svg>
      )
    },
    {
      quarter: 'Q3 2026',
      priority: 'Phase 2',
      title: 'Meta API Integration',
      status: 'active',
      description: 'Transitioning from sandbox to official WhatsApp Cloud API channels to guarantee ultra-high notification speeds, custom quick-reply buttons, and secure business flows.',
      points: [
        'Official Meta Cloud API channels',
        'Premium WhatsApp quick-reply buttons',
        'Verified business number setup'
      ],
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
        </svg>
      )
    },
    {
      quarter: 'Q4 2026',
      priority: 'Phase 3',
      title: 'Group Chat Automation',
      status: 'upcoming',
      description: 'Bringing bot capabilities inside group chats, enabling split bills with auto-pay links, red packet airdrops, peer tipping, raffles, payment alerts, and a friendly Stellar Q&A assistant.',
      points: [
        'AI Group Split & Auto-Pay links',
        'On-Chain Red Packet Airdrops',
        'Instant Peer-to-Peer Tipping',
        'On-Chain Group Raffles & Giveaways',
        'Real-Time Group Payment Alerts'
      ],
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
      )
    },
    {
      quarter: 'Q1 2027',
      priority: 'Phase 4',
      title: 'Telegram Mini App',
      status: 'upcoming',
      description: 'Launching a native Telegram Mini App interface using identical phone-verified user data, enabling visual wallet dashboards directly inside Telegram chats.',
      points: [
        'Unified user account mapping',
        'Telegram WebApp client dashboard',
        'Sleek inline wallet interfaces'
      ],
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      )
    },
    {
      quarter: 'Q2 2027',
      priority: 'Phase 5',
      title: 'Cross-Chain Bridging',
      status: 'upcoming',
      description: 'Enabling cross-chain asset bridging and intent-based token swaps natively between Soroban contracts and other EVM layer-2 chains (e.g. Base, Optimism).',
      points: [
        'Soroban to EVM bridge routing',
        'Intent-based transaction matching',
        'Gas-less client transaction fees'
      ],
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="16 3 21 8 16 13"></polyline>
          <line x1="21" y1="8" x2="9" y2="8"></line>
          <polyline points="8 21 3 16 8 11"></polyline>
          <line x1="3" y1="16" x2="15" y2="16"></line>
        </svg>
      )
    },
    {
      quarter: 'Q3 2027',
      priority: 'Phase 6',
      title: 'Stellar On & Off-Ramps',
      status: 'upcoming',
      description: 'Partnering with local Stellar anchors using SEP-24 to support direct bank account fiat-to-crypto deposits and withdrawals globally.',
      points: [
        'SEP-24 anchor interoperability',
        'Direct bank ACH & SEPA transfers',
        'Ultra-low fee local fiat routing'
      ],
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="4" width="16" height="16" rx="2"></rect>
          <rect x="9" y="9" width="6" height="6"></rect>
        </svg>
      )
    }
  ];

  return (
    <div style={{ overflowX: 'hidden', minHeight: '100vh', background: 'var(--bg-color)', position: 'relative' }}>
      
      {/* Styles matching the horizontal reference layout on desktop and vertical stack on mobile */}
      <style dangerouslySetInnerHTML={{ __html: `
        html {
          scroll-snap-type: none !important;
        }

        /* Float Back Button Styles */
        .floating-back-btn {
          position: fixed;
          top: 30px;
          left: 5%;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 18px;
          border-radius: 30px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--glass-border);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          color: var(--text-primary);
          text-decoration: none;
          font-weight: 600;
          font-size: 14px;
          transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
          z-index: 999;
          white-space: nowrap;
        }
        
        .floating-back-btn:hover {
          background: rgba(129, 199, 132, 0.1);
          border-color: var(--accent-1);
          color: var(--accent-1);
          transform: translateX(-4px);
        }

        .floating-back-btn .back-label {
          display: inline;
        }

        /* On mobile: drop it below the pill nav, show icon only */
        @media (max-width: 768px) {
          .floating-back-btn {
            top: 80px;
            left: 16px;
            padding: 9px 14px;
            font-size: 13px;
          }
          .floating-back-btn .back-label {
            display: none; /* hide text, keep arrow icon */
          }
        }

        .roadmap-container {
          width: 100%;
          max-width: 1300px;
          margin: 180px auto 100px;
          padding: 0 40px;
          position: relative;
        }

        .roadmap-header {
          text-align: center;
          margin-bottom: 80px;
        }

        .roadmap-header p {
          color: var(--text-secondary);
          margin-top: 10px;
          font-size: 18px;
        }

        /* Desktop Dual-Row Horizontal Timeline Layout */
        .desktop-timeline {
          display: block;
          width: 100%;
        }

        .roadmap-timeline-track {
          position: relative;
          width: 100%;
          height: 80px;
          display: flex;
          align-items: center; /* guarantees vertical centering */
        }

        .timeline-base-line {
          position: absolute;
          left: 8.33%;
          right: 8.33%;
          height: 3px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
          z-index: 1;
        }

        .timeline-progress-fill {
          height: 100%;
          width: 20%; /* Completed Phase 1 (Core platform), ending at Phase 2 (20% filled line) */
          background: linear-gradient(90deg, var(--accent-1), var(--accent-3));
          box-shadow: 0 0 12px var(--accent-1);
        }

        .timeline-nodes-row {
          position: absolute;
          left: 0;
          right: 0;
          display: flex;
          justify-content: space-around;
          z-index: 2;
        }

        .timeline-node-point {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 120px;
        }

        .node-quarter-text {
          font-family: var(--font-mono);
          font-size: 13px;
          font-weight: 700;
          color: var(--text-secondary);
          margin-bottom: 12px;
          letter-spacing: 0.5px;
          transition: color 0.3s ease;
        }

        .node-quarter-text.active, .node-quarter-text.completed {
          color: var(--accent-1);
        }

        .node-dot-circle {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--bg-color);
          border: 4px solid rgba(255, 255, 255, 0.2);
          box-shadow: 0 0 8px rgba(0, 0, 0, 0.6);
          transition: all 0.3s ease;
        }

        .node-dot-circle.completed {
          border-color: var(--accent-1);
          background: var(--accent-1);
          box-shadow: 0 0 12px var(--accent-1);
        }

        .node-dot-circle.active {
          border-color: var(--accent-1);
          background: var(--bg-color);
          box-shadow: 0 0 15px var(--accent-1);
          animation: nodePulse 2s infinite;
        }

        @keyframes nodePulse {
          0% { box-shadow: 0 0 0 0 rgba(129, 199, 132, 0.6); }
          70% { box-shadow: 0 0 0 10px rgba(129, 199, 132, 0); }
          100% { box-shadow: 0 0 0 0 rgba(129, 199, 132, 0); }
        }

        .timeline-cards-row {
          display: flex;
          justify-content: space-around;
          margin-top: 10px;
          width: 100%;
        }

        .timeline-card-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 15%;
        }

        .node-connector-vertical {
          width: 2px;
          height: 35px;
          background: rgba(255, 255, 255, 0.1);
          margin-bottom: 16px;
        }

        .node-connector-vertical.completed, .node-connector-vertical.active {
          background: var(--accent-1);
        }

        .node-card {
          width: 100%;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--glass-border);
          border-radius: 18px;
          padding: 22px;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          text-align: left;
          transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
        }

        .node-card:hover {
          transform: translateY(-6px);
          border-color: var(--accent-1);
          background: rgba(129, 199, 132, 0.05);
          box-shadow: 0 12px 30px rgba(129, 199, 132, 0.12);
        }

        /* Glowing Highlight Box (Mainnet Launch style) */
        .node-card.highlighted-box {
          background: rgba(23, 63, 53, 0.25);
          border: 2px solid var(--accent-1);
          box-shadow: 0 0 25px rgba(129, 199, 132, 0.18);
        }

        .node-card.highlighted-box:hover {
          box-shadow: 0 0 35px rgba(129, 199, 132, 0.28);
        }

        .card-icon-wrap {
          color: var(--accent-1);
          margin-bottom: 12px;
          display: inline-flex;
        }

        .node-card h4 {
          font-size: 15px;
          font-weight: 500;
          color: var(--accent-1);
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
        }

        .node-card h3 {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 10px;
        }

        .node-card p {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.5;
          margin-bottom: 16px;
        }

        .card-bullet-points {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .card-bullet-points li {
          font-size: 12px;
          color: var(--text-secondary);
          position: relative;
          padding-left: 14px;
          margin-bottom: 8px;
          line-height: 1.4;
        }

        .card-bullet-points li::before {
          content: "•";
          color: var(--accent-1);
          position: absolute;
          left: 0;
          font-size: 14px;
        }

        /* Mobile Vertical Timeline Stack Styles */
        .mobile-timeline {
          display: none;
        }

        /* Mobile Responsive Fallback (max-width: 991px) */
        @media (max-width: 991px) {
          .desktop-timeline {
            display: none;
          }

          .mobile-timeline {
            display: block;
            position: relative;
            padding-left: 30px;
            margin-top: 40px;
            width: 100%;
          }

          .mobile-progress-line {
            position: absolute;
            left: 41px;
            top: 20px;
            bottom: 20px;
            width: 3px;
            background: rgba(255, 255, 255, 0.1);
            z-index: 1;
          }

          .mobile-progress-fill {
            width: 100%;
            height: 20%; /* 1 completed step out of 5 segments */
            background: linear-gradient(180deg, var(--accent-1), var(--accent-3));
            box-shadow: 0 0 12px var(--accent-1);
          }

          .mobile-timeline-item {
            display: flex;
            align-items: flex-start;
            gap: 20px;
            margin-bottom: 50px;
            position: relative;
          }

          .mobile-node-date {
            width: 70px;
            text-align: right;
            font-family: var(--font-mono);
            font-size: 13px;
            font-weight: 700;
            color: var(--text-secondary);
            padding-top: 4px;
            flex-shrink: 0;
          }

          .mobile-node-date.active, .mobile-node-date.completed {
            color: var(--accent-1);
          }

          .mobile-node-dot {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: var(--bg-color);
            border: 4px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 0 8px rgba(0, 0, 0, 0.6);
            flex-shrink: 0;
            z-index: 2;
            transition: all 0.3s ease;
          }

          .mobile-node-dot.completed {
            border-color: var(--accent-1);
            background: var(--accent-1);
            box-shadow: 0 0 12px var(--accent-1);
          }

          .mobile-node-dot.active {
            border-color: var(--accent-1);
            background: var(--bg-color);
            box-shadow: 0 0 15px var(--accent-1);
            animation: nodePulse 2s infinite;
          }

          .mobile-timeline-item .node-card {
            flex-grow: 1;
            margin-top: -6px;
          }
        }
      `}} />

      {/* Premium Canvas Animation Backgrounds */}
      <div className="mesh-bg"></div>
      <div className="hero-orb hero-orb-1"></div>
      <div className="hero-orb hero-orb-2"></div>

      {/* Floating Back to Home button */}
      <Link href="/" className="floating-back-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        <span className="back-label">Back to Home</span>
      </Link>

      {/* Navigation Pills */}
      <PillNav
          items={navItems}
          activeHref="/roadmap"
          baseColor="rgba(23, 63, 53, 0.4)"
          pillColor="rgba(255, 255, 255, 0.04)"
          hoveredPillTextColor="#173F35"
          pillTextColor="white"
      />

      {/* Main Roadmap Container */}
      <div className="roadmap-container">
        
        {/* Header Title */}
        <div className="roadmap-header">
          <BlurText
            text="Product Roadmap"
            delay={100}
            animateBy="words"
            direction="top"
            className="roadmap-title"
            style={{ fontSize: '56px', fontWeight: 800, color: 'var(--text-primary)' }}
          />
          <p>Key development milestones and priority deliverables</p>
        </div>

        {/* Desktop Dual-Row Horizontal Timeline */}
        <div className="desktop-timeline">
          <div className="roadmap-timeline-track">
            <div className="timeline-base-line">
              <div className="timeline-progress-fill"></div>
            </div>
            <div className="timeline-nodes-row">
              {items.map((item, idx) => {
                const isCompleted = item.status === 'completed';
                const isActive = item.status === 'active';
                return (
                  <div key={idx} className="timeline-node-point">
                    <div className={`node-quarter-text ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}>{item.quarter}</div>
                    <div className={`node-dot-circle ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}></div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="timeline-cards-row">
            {items.map((item, idx) => (
              <div key={idx} className="timeline-card-col">
                <div className={`node-connector-vertical ${item.status === 'completed' || item.status === 'active' ? 'completed' : ''}`}></div>
                <div className={`node-card ${item.isHighlight ? 'highlighted-box' : ''}`}>
                  <div className="card-icon-wrap">
                    {item.icon}
                  </div>
                  <h4>{item.priority}</h4>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <ul className="card-bullet-points">
                    {item.points.map((pt, pIdx) => (
                      <li key={pIdx}>{pt}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mobile Vertical Timeline Stack */}
        <div className="mobile-timeline">
          <div className="mobile-progress-line">
            <div className="mobile-progress-fill"></div>
          </div>
          {items.map((item, idx) => {
            const isCompleted = item.status === 'completed';
            const isActive = item.status === 'active';
            return (
              <div key={idx} className="mobile-timeline-item">
                <div className={`mobile-node-date ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}>{item.quarter}</div>
                <div className={`mobile-node-dot ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}></div>
                <div className={`node-card ${item.isHighlight ? 'highlighted-box' : ''}`}>
                  <div className="card-icon-wrap">
                    {item.icon}
                  </div>
                  <h4>{item.priority}</h4>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <ul className="card-bullet-points">
                    {item.points.map((pt, pIdx) => (
                      <li key={pIdx}>{pt}</li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* Footer */}
      <footer className="glass" style={{ textAlign: 'center', padding: '30px 20px', borderTop: '1px solid var(--glass-border)', marginTop: '80px' }}>
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
          X: <a href="https://x.com/stellapp_chat" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-1)', textDecoration: 'none', fontWeight: 600 }}>@stellapp_chat</a>
        </p>
      </footer>

    </div>
  );
}
