'use client';

import React, { useState } from 'react';
import Head from 'next/head';

export default function LoginPage() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [countryCode, setCountryCode] = useState('+54');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fullPhoneNumber = `${countryCode}${phoneNumber}`;
  const isPhoneValid = phoneNumber.length >= 8;
  const isOtpValid = otp.length === 4;

  const handleRequestOTP = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('http://localhost:8081/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: fullPhoneNumber })
      });
      const data = await res.json();
      if (data.success) {
        setStep('otp');
      } else {
        setError(data.error || 'Failed to send OTP');
      }
    } catch (err) {
      setError('Network error');
    }
    setLoading(false);
  };

  const handleVerifyOTP = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('http://localhost:8081/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: fullPhoneNumber, code: otp })
      });
      const data = await res.json();
      if (data.success) {
        // Handle successful login (store token, redirect to dashboard)
        localStorage.setItem('stellapp_token', data.token);
        alert('Login Successful! Redirecting to Dashboard...');
        // window.location.href = '/dashboard';
      } else {
        setError(data.error || 'Invalid OTP');
      }
    } catch (err) {
      setError('Network error');
    }
    setLoading(false);
  };

  return (
    <div className="split-container">
      {/* LEFT PANEL */}
      <div className="left-panel">
        <div className="logo-container">
          <div className="logo-circle">S</div>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>Stellapp</span>
        </div>

        <div className="login-form-container">
          <h1 className="title">Sign in to Stellapp</h1>
          <p className="subtitle">
            {step === 'phone' ? (
              <>New User? <a href="#">Create an account</a></>
            ) : (
              <a href="#" onClick={(e) => { e.preventDefault(); setStep('phone'); }}>← Back to phone number</a>
            )}
          </p>

          {error && <div style={{ color: '#ef4444', backgroundColor: '#fee2e2', padding: '10px', borderRadius: '8px', marginBottom: '15px', fontSize: '14px', border: '1px solid #fca5a5' }}>{error}</div>}

          {step === 'phone' ? (
            <>
              <div className="input-group">
                <label>Country</label>
                <select className="input-field" value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                  <option value="+54">Argentina (+54)</option>
                  <option value="+1">United States (+1)</option>
                  <option value="+44">United Kingdom (+44)</option>
                  <option value="+55">Brazil (+55)</option>
                  <option value="+91">India (+91)</option>
                </select>
              </div>

              <div className="input-group">
                <label>Phone Number</label>
                <input 
                  type="tel" 
                  className="input-field" 
                  placeholder="Phone Number" 
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="info-box">
                <div className="info-icon">i</div>
                <div>
                  Enter phone number with area code, without 0 and without 15
                </div>
              </div>

              <button 
                className={`submit-btn ${isPhoneValid && !loading ? 'active' : ''}`} 
                disabled={!isPhoneValid || loading}
                onClick={handleRequestOTP}
              >
                {loading ? 'Sending...' : 'Send Code to Whatsapp'}
              </button>
            </>
          ) : (
            <>
              <div className="input-group">
                <label>Verification Code</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="4-digit OTP" 
                  maxLength={4}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  disabled={loading}
                  style={{ letterSpacing: '4px', textAlign: 'center', fontSize: '1.2rem', fontWeight: 'bold' }}
                />
              </div>

              <div className="info-box">
                <div className="info-icon">i</div>
                <div>
                  We sent a 4-digit code to {fullPhoneNumber} on WhatsApp.
                </div>
              </div>

              <button 
                className={`submit-btn ${isOtpValid && !loading ? 'active' : ''}`} 
                disabled={!isOtpValid || loading}
                onClick={handleVerifyOTP}
              >
                {loading ? 'Verifying...' : 'Verify & Sign In'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="right-panel">
        <div className="bg-shape"></div>
        
        <div className="widgets-container">
          
          <div className="widget">
            <div className="widget-icon green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </div>
            <div className="widget-content">
              <h4>Received $1,000 from Juan</h4>
              <p>+54 123 456789</p>
              <p className="note">Note: January Payment</p>
            </div>
          </div>

          <div className="widget">
            <div className="widget-icon gray">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </div>
            <div className="widget-content">
              <h4>Sent $15 to Pedro</h4>
              <p>+54 987 654321</p>
              <p className="note">Note: Dinner</p>
            </div>
          </div>

          <div className="widget">
            <div className="widget-icon orange">
              ₿
            </div>
            <div className="widget-content">
              <h4>Purchased $10 of BTC</h4>
              <p>Uniswap V3</p>
            </div>
          </div>

          <div className="widget">
            <div className="widget-icon gray">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10"></path><path d="M18 20V4"></path><path d="M6 20v-4"></path></svg>
            </div>
            <div className="widget-content">
              <h4>Deposited $100 USDC</h4>
              <p>AAVE v3 - Now earning ~5% APR!</p>
            </div>
          </div>

        </div>

        <div className="footer-text">
          Use crypto, directly in WhatsApp 
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.888-.788-1.489-1.761-1.663-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
          </svg>
        </div>
      </div>
    </div>
  );
}
