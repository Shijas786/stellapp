'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Lock, Phone, MessageSquare, CheckCircle } from 'lucide-react';
import '../landing.css';

export default function LoginPage() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) {
      setError('Please enter a valid phone number');
      return;
    }
    setError('');
    setLoading(true);
    // Simulate sending OTP
    setTimeout(() => {
      setLoading(false);
      setStep('otp');
    }, 1000);
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length < 4) {
      setError('Please enter a valid verification code');
      return;
    }
    setError('');
    setLoading(true);
    // Simulate authentication
    setTimeout(() => {
      setLoading(false);
      localStorage.setItem('stellapp_token', 'mock_session_token_' + Date.now());
      localStorage.setItem('stellapp_phone', phoneNumber);
      router.push('/dashboard/dashboard');
    }, 1200);
  };

  return (
    <div className="login-wrapper">
      <style dangerouslySetInnerHTML={{ __html: `
        .login-wrapper {
          min-height: 100vh;
          background: #090b11;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Inter', sans-serif;
          padding: 20px;
          position: relative;
          overflow: hidden;
        }

        .login-bg-glow {
          position: absolute;
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(0, 250, 154, 0.05) 0%, transparent 70%);
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 1;
          pointer-events: none;
        }

        .login-card {
          width: 100%;
          max-width: 440px;
          background: rgba(17, 22, 37, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.06);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-radius: 24px;
          padding: 40px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
          z-index: 2;
          text-align: center;
        }

        .login-logo {
          width: 48px;
          height: 48px;
          background: linear-gradient(135deg, #00fa9a, #2E7D32);
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 24px;
          color: #000;
          box-shadow: 0 0 20px rgba(0, 250, 154, 0.3);
          margin-bottom: 24px;
        }

        .login-card h2 {
          font-size: 28px;
          font-weight: 800;
          color: #fff;
          margin: 0 0 10px 0;
          letter-spacing: -0.5px;
        }

        .login-card p {
          font-size: 14px;
          color: #94a3b8;
          line-height: 1.5;
          margin: 0 0 30px 0;
        }

        .input-group {
          position: relative;
          margin-bottom: 20px;
          text-align: left;
        }

        .input-group label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }

        .input-field-wrap {
          position: relative;
        }

        .input-icon {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #64748b;
          width: 18px;
          height: 18px;
        }

        .input-field {
          width: 100%;
          background: rgba(10, 13, 22, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 14px 16px 14px 46px;
          color: #fff;
          font-size: 15px;
          transition: all 0.3s;
        }

        .input-field:focus {
          border-color: #00fa9a;
          box-shadow: 0 0 10px rgba(0, 250, 154, 0.15);
          outline: none;
          background: rgba(10, 13, 22, 0.7);
        }

        .login-btn {
          width: 100%;
          background: #00fa9a;
          color: #090b11;
          border: none;
          padding: 14px;
          border-radius: 12px;
          font-weight: 700;
          font-size: 15px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.3s;
          margin-top: 10px;
        }

        .login-btn:hover {
          background: #00e58c;
          transform: translateY(-1px);
          box-shadow: 0 4px 15px rgba(0, 250, 154, 0.2);
        }

        .login-btn:disabled {
          background: rgba(0, 250, 154, 0.5);
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .error-message {
          font-size: 13px;
          color: #ef4444;
          margin-bottom: 15px;
          display: block;
          text-align: left;
        }

        .back-link {
          display: inline-block;
          font-size: 13px;
          color: #94a3b8;
          text-decoration: none;
          margin-top: 20px;
          transition: color 0.2s;
        }

        .back-link:hover {
          color: #00fa9a;
        }
      `}} />
      <div className="login-bg-glow" />
      <div className="login-card">
        <div className="login-logo">S</div>
        <h2>Stellapp Dashboard</h2>
        <p>Access your Stellapp wallet, transaction histories, and customized active smart contracts.</p>

        {error && <span className="error-message">{error}</span>}

        {step === 'phone' ? (
          <form onSubmit={handleSendOtp}>
            <div className="input-group">
              <label>Phone Number</label>
              <div className="input-field-wrap">
                <Phone className="input-icon" />
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  className="input-field"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Sending Code...' : 'Request Access Code'}
              <ArrowRight size={16} />
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <div className="input-group">
              <label>Verification Code (OTP)</label>
              <div className="input-field-wrap">
                <Lock className="input-icon" />
                <input
                  type="text"
                  maxLength={6}
                  placeholder="Enter 4 or 6 digit OTP"
                  className="input-field"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Verifying...' : 'Unlock Dashboard'}
              <CheckCircle size={16} />
            </button>
            <a href="#" className="back-link" onClick={(e) => { e.preventDefault(); setStep('phone'); }}>
              ← Change Phone Number
            </a>
          </form>
        )}
      </div>
    </div>
  );
}
