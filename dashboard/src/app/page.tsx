'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import ScrollStack, { ScrollStackItem } from '../components/ScrollStack';
import BlurText from '../components/BlurText';
import './landing.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { ArrowRight, Menu, X } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const navItems = [
  { label: 'Roadmap', href: '/roadmap' },
  { label: 'Connect', href: 'https://wa.me/917012751478?text=create%20wallet' }
];

const HlsVideoBackground = () => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let hls: any;
    const video = videoRef.current;
    if (!video) return;

    const playVideo = () => {
      video.play().catch(err => {
        console.log("Autoplay blocked:", err);
        // Try force playing on first interaction (touchstart, click, scroll)
        const forcePlay = () => {
          video.play().catch(() => {});
          window.removeEventListener('touchstart', forcePlay);
          window.removeEventListener('click', forcePlay);
          window.removeEventListener('scroll', forcePlay);
        };
        window.addEventListener('touchstart', forcePlay, { passive: true });
        window.addEventListener('click', forcePlay, { passive: true });
        window.addEventListener('scroll', forcePlay, { passive: true });
      });
    };

    const initVideo = async () => {
      const Hls = (await import('hls.js')).default;
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: false });
        hls.loadSource('https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8');
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          playVideo();
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = 'https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8';
        video.addEventListener('loadedmetadata', playVideo);
      }
    };
    initVideo();

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, []);

  return (
    <div className="hero-video-container">
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        controls={false}
        className="hero-video"
      />
      <div className="hero-video-overlay-left"></div>
      <div className="hero-video-overlay-bottom"></div>
    </div>
  );
};

export default function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Phone Mockup WhatsApp live chat simulation states
  const [phoneMessages, setPhoneMessages] = React.useState<Array<{ id: number; type: 'sent' | 'received'; text: string; time: string; typing?: boolean }>>([]);
  const [phoneInput, setPhoneInput] = React.useState('Message');
  const [isKeyboardActive, setIsKeyboardActive] = React.useState(false);
  const [botStatus, setBotStatus] = React.useState('online');
  const [activeTab, setActiveTab] = React.useState(0);

  const phoneBodyRef = useRef<HTMLDivElement>(null);

  // Live IST clock for phone status bar
  const [liveTime, setLiveTime] = React.useState('');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      // Format as H:MM (no AM/PM) matching real iOS status bar
      setLiveTime(now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (phoneBodyRef.current) {
      phoneBodyRef.current.scrollTop = phoneBodyRef.current.scrollHeight;
    }
  }, [phoneMessages, isKeyboardActive]);


  // Track which key is visually "pressed" on the keyboard
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const [keyboardMode, setKeyboardMode] = React.useState<'alpha' | 'numeric'>('alpha');

  const featuresData = [
    {
      num: "01",
      title: "Send money globally, instantly",
      desc: "Transfer USDC or XLM to any contact or phone number without dealing with keys, complex wallet setups, or bank delays.",
      benefits: ["Resolves usernames & contacts", "Instant transaction receipts", "Near-zero transaction fees"]
    },
    {
      num: "02",
      title: "Deploy Contracts",
      desc: "Write, compile, and deploy custom token contracts directly from WhatsApp. Define name, symbol, and supply dynamically in chat.",
      benefits: ["Interactive contract parameters", "AI-compiled custom WASM", "Custom token contract standards"]
    },
    {
      num: "03",
      title: "ZK Privacy Pool",
      desc: "Mix and transfer tokens anonymously using Zero-Knowledge secret notes. Your transactions are decoupled from your address history.",
      benefits: ["Total counterparty shielding", "Anonymous secret note mixing", "Zero trace on public explorer"]
    },
    {
      num: "04",
      title: "Confidential Transfer",
      desc: "Send payments confidentially to shield transfer amounts. Harness homomorphic encryption to keep your transaction values hidden from public trackers.",
      benefits: ["Encrypted transfer amounts", "ZK Range validation proofs", "Shielded wallet balances"]
    },
    {
      num: "05",
      title: "Automated Alerts & Jobs",
      desc: "Schedule automated recurring payments (DCA) and get real-time notification alerts whenever assets are received in your wallet.",
      benefits: ["Recurring payments & DCA", "Real-time receipt notifications", "Background state synchronization"]
    }
  ];


  useGSAP(() => {
    // 1. Hero Text Reveal Animation
    const heroTitle = document.querySelector(".hero h1") as HTMLElement;
    if (heroTitle && !heroTitle.dataset.animated) {
      heroTitle.dataset.animated = "true";
      const text = heroTitle.innerHTML;
      const splitText = text.split(/(<br\/?>|<span[^>]*>|<\/span>|\s+)/i).filter(Boolean);
      
      heroTitle.innerHTML = "";
      splitText.forEach(part => {
          if (part.startsWith("<")) {
              heroTitle.innerHTML += part;
          } else if (part.trim() !== "") {
              const span = document.createElement("span");
              span.innerHTML = part + " ";
              heroTitle.appendChild(span);
          } else {
              heroTitle.innerHTML += " ";
          }
      });

      gsap.from(".hero h1 span", {
          y: 50,
          opacity: 0,
          duration: 1,
          stagger: 0.1,
          ease: "back.out(1.7)",
          delay: 0.2
      });
    }

    gsap.fromTo(".hero p", 
      { y: 30, opacity: 0 },
      { y: 0, opacity: 1, duration: 1, ease: "power3.out", delay: 0.8 }
    );

    gsap.fromTo(".cta-group .primary-btn, .cta-group .secondary-btn",
      { y: 20, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.8, stagger: 0.2, ease: "power2.out", delay: 1.2 }
    );

    // 2. Scroll-Triggered Bento Cards
    gsap.from(".bento-header", {
        scrollTrigger: {
            trigger: ".bento-features",
            start: "top 60%",
            toggleActions: "play none none reverse"
        },
        y: 30,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out"
    });

    gsap.utils.toArray(".bento-card").forEach((card: any, index) => {
        const isDark = card.classList.contains("dark-card");
        gsap.fromTo(card, {
            y: 50,
            opacity: 0,
            borderColor: "rgba(129, 199, 132, 0.02)",
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.1)"
        }, {
            scrollTrigger: {
                trigger: card,
                start: "top 80%",
                toggleActions: "play none none reverse"
            },
            y: 0,
            opacity: 1,
            borderColor: isDark ? "rgba(129, 199, 132, 0.25)" : "rgba(23, 63, 53, 0.15)",
            boxShadow: isDark 
                ? "0 15px 35px rgba(23, 63, 53, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.05)"
                : "0 15px 35px rgba(0, 0, 0, 0.03)",
            duration: 1.1,
            ease: "power4.out",
            delay: index * 0.15
        });
    });

    // Scroll-Triggered Comparison Cards (Glow & Float)
    gsap.utils.toArray(".comparison-card").forEach((card: any, index) => {
        const isZk = card.innerHTML.includes("ZK Privacy Pool");
        const isConfidential = card.innerHTML.includes("Confidential Transfer");
        
        let targetBorderColor = "rgba(239, 68, 68, 0.25)"; // default standard (red label alert)
        let targetBoxShadow = "0 15px 35px rgba(239, 68, 68, 0.06)";
        if (isZk) {
            targetBorderColor = "rgba(124, 58, 237, 0.35)"; // purple
            targetBoxShadow = "0 15px 35px rgba(124, 58, 237, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.05)";
        } else if (isConfidential) {
            targetBorderColor = "rgba(129, 199, 132, 0.35)"; // green
            targetBoxShadow = "0 15px 35px rgba(129, 199, 132, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.05)";
        }

        gsap.fromTo(card, {
            y: 60,
            opacity: 0,
            borderColor: "rgba(255, 255, 255, 0.03)",
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.1)"
        }, {
            scrollTrigger: {
                trigger: card,
                start: "top 85%",
                toggleActions: "play none none reverse"
            },
            y: 0,
            opacity: 1,
            borderColor: targetBorderColor,
            boxShadow: targetBoxShadow,
            duration: 1.3,
            ease: "power4.out",
            delay: index * 0.2
        });
    });

    // 3. Scroll-Triggered FAQ
    gsap.from(".faq-title", {
        scrollTrigger: {
            trigger: ".faq-section",
            start: "top 60%",
            toggleActions: "play none none reverse"
        },
        y: 30,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out"
    });

    gsap.utils.toArray(".faq-item").forEach((item: any, index) => {
        gsap.from(item, {
            scrollTrigger: {
                trigger: ".faq-section",
                start: "top 60%",
                toggleActions: "play none none reverse"
            },
            x: -30,
            opacity: 0,
            duration: 0.6,
            ease: "power3.out",
            delay: index * 0.1 + 0.3
        });
    });

    // 4. Navbar Scroll Blur Effect
    const navbar = document.querySelector(".navbar") as HTMLElement;
    const handleScroll = () => {
        if (!navbar) return;
        if (window.scrollY > 50) {
            navbar.style.background = "rgba(12, 13, 16, 0.8)";
            navbar.style.boxShadow = "0 4px 30px rgba(0, 0, 0, 0.5)";
        } else {
            navbar.style.background = "transparent";
            navbar.style.boxShadow = "none";
        }
    };
    window.addEventListener("scroll", handleScroll);

    // Magnetic Buttons
    const magneticWraps = document.querySelectorAll(".magnetic-wrap");
    magneticWraps.forEach(wrap => {
        const btn = wrap.querySelector(".nav-btn");
        wrap.addEventListener("mousemove", (e: any) => {
            const rect = wrap.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            gsap.to(btn, { x: x * 0.4, y: y * 0.4, duration: 0.3, ease: "power2.out" });
        });
        wrap.addEventListener("mouseleave", () => {
            gsap.to(btn, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.3)" });
        });
    });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, { scope: containerRef });

  // PixelBlast is now loaded via React component

  const toggleFaq = (e: React.MouseEvent<HTMLButtonElement>) => {
    const faqItem = e.currentTarget.parentElement;
    if (!faqItem) return;
    const isActive = faqItem.classList.contains('active');
    document.querySelectorAll('.faq-item').forEach(item => {
        item.classList.remove('active');
    });
    if (!isActive) {
        faqItem.classList.add('active');
    }
  };

  const toggleKeyboard = () => {
    const keyboard = document.getElementById('mockup-keyboard');
    const inputSpan = document.querySelector('#mockup-input span') as HTMLElement;
    if (keyboard && inputSpan) {
      keyboard.classList.toggle('active');
      inputSpan.innerHTML = keyboard.classList.contains('active') ? 'Send 10 USDC to shijas|' : 'Message';
      inputSpan.style.color = keyboard.classList.contains('active') ? '#fff' : '#d1d7db';
    }
  };

  useEffect(() => {
    setTimeout(() => {
        const typing = document.querySelector('.typing');
        if (typing) {
            typing.innerHTML = "✅ Transaction successful! Sent 10 USDC to shijas*stellapp.com.<br><br>Tx Hash: <code>a7f8...9b2c</code><div class='msg-time'>10:42 AM</div>";
            typing.classList.remove('typing');
        }
    }, 3000);
  }, []);

  useEffect(() => {
    let active = true;
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const typeText = async (text: string, onUpdate: (val: string) => void, speedMs = 110) => {
      let current = '';
      for (const char of text) {
        if (!active) return;
        current += char;
        onUpdate(current);
        const isDigit = /\d/.test(char);
        setKeyboardMode(isDigit ? 'numeric' : 'alpha');
        const key = isDigit ? char : char.toUpperCase();
        setActiveKey(key);
        setTimeout(() => setActiveKey(null), speedMs - 5);
        await sleep(speedMs);
      }
      // Reset keyboard to alpha after typing finishes
      setTimeout(() => setKeyboardMode('alpha'), 300);
    };

    const runLoop = async () => {
      while (active) {
        // Reset state
        setPhoneMessages([]);
        setPhoneInput('Message');
        setIsKeyboardActive(false);
        setBotStatus('online');
        await sleep(1000);

        if (!active) break;

        if (activeTab === 0) {
          // --- Scenario 0: Normal Send ---
          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("Send 10 USDC to Amal", setPhoneInput, 110);
          await sleep(400);
          if (!active) break;
          const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setPhoneMessages(prev => [...prev, { id: 1, type: 'sent', text: "Send 10 USDC to Amal", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 2, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(1500);
          if (!active) break;

          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 3,
            type: 'received',
            text: "💱 *Send Confirmation*\n\nYou want to send *10.00 USDC* to *Amal*.\nAddress: `GC31...8P4A`\n\nReply with *Confirm* to proceed.",
            time: t
          }]);
          setBotStatus('online');
          await sleep(2500);
          if (!active) break;

          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("confirm", setPhoneInput, 130);
          await sleep(400);
          if (!active) break;
          setPhoneMessages(prev => [...prev, { id: 4, type: 'sent', text: "confirm", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 5, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(2000);
          if (!active) break;

          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 6,
            type: 'received',
            text: "✅ *Transaction Successful!* 📤\n\nSent *10.00 USDC* to *Amal*.\nAddress: `GC31...8P4A`\n\nTx Hash: `a7f8b9c2...`\nExplorer: https://stellar.org/tx/a7f8b9c2",
            time: t
          }]);
          setBotStatus('online');

        } else if (activeTab === 1) {
          // --- Scenario 1: Deploy Custom Token ---
          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("deploy a custom token", setPhoneInput, 110);
          await sleep(400);
          if (!active) break;
          const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setPhoneMessages(prev => [...prev, { id: 1, type: 'sent', text: "deploy a custom token", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 2, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(1500);
          if (!active) break;

          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 3,
            type: 'received',
            text: "To deploy a custom token contract on Stellar, I need three parameters:\n1. Token Name\n2. Token Symbol\n3. Initial Supply\n\nPlease provide the **Token Name** first:",
            time: t
          }]);
          setBotStatus('online');
          await sleep(2500);
          if (!active) break;

          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("Stellapp Token", setPhoneInput, 110);
          await sleep(400);
          if (!active) break;
          setPhoneMessages(prev => [...prev, { id: 4, type: 'sent', text: "Stellapp Token", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 5, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(1200);
          if (!active) break;

          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 6,
            type: 'received',
            text: "Got it. Now, what should be the **Token Symbol** (e.g. SLP)?",
            time: t
          }]);
          setBotStatus('online');
          await sleep(2500);
          if (!active) break;

          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("SLP", setPhoneInput, 110);
          await sleep(400);
          if (!active) break;
          setPhoneMessages(prev => [...prev, { id: 7, type: 'sent', text: "SLP", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 8, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(1200);
          if (!active) break;

          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 9,
            type: 'received',
            text: "Got it. Finally, specify the **Initial Supply** (e.g. 1000000) for the token:",
            time: t
          }]);
          setBotStatus('online');
          await sleep(2500);
          if (!active) break;

          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("1000000", setPhoneInput, 130);
          await sleep(400);
          if (!active) break;
          setPhoneMessages(prev => [...prev, { id: 10, type: 'sent', text: "1000000", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 11, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(1500);
          if (!active) break;

          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 12,
            type: 'received',
            text: "Here is a summary of your custom token before compilation & deployment:\n• *Name:* Stellapp Token\n• *Symbol:* SLP\n• *Initial Supply:* 1,000,000 SLP\n• *Standard:* Soroban Token (SEP-41)\n\nReply with *Confirm* to build and deploy to Stellar Testnet.",
            time: t
          }]);
          setBotStatus('online');
          await sleep(3500);
          if (!active) break;

          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("confirm", setPhoneInput, 130);
          await sleep(400);
          if (!active) break;
          setPhoneMessages(prev => [...prev, { id: 13, type: 'sent', text: "confirm", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          setPhoneMessages(prev => [...prev, {
            id: 14,
            type: 'received',
            text: "⏳ *Deploying Token Contract...*\n\nThis involves writing the SEP-41 token implementation in Rust, compiling it to WASM, and deploying it to Stellar Testnet. This usually takes around 20-30 seconds. Please wait!",
            time: t
          }]);
          setBotStatus('typing...');
          await sleep(4000);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 15, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(2500);
          if (!active) break;

          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 16,
            type: 'received',
            text: "✅ *Token Deployed Successfully!* 🪙\n\n• *Token Name:* Stellapp Token\n• *Symbol:* SLP\n• *Token ID:* `CD3X...9W2F`\n• *Supply:* `1,000,000` (minted to your wallet)\n• *WASM Hash:* `d8f4a7c0...`\n• *Explorer:* https://stellar.org/contract/CD3X...9W2F\n\nYou can now send, swap, or link this token to privacy pools!",
            time: t
          }]);
          setBotStatus('online');

        } else if (activeTab === 2) {
          // --- Scenario 2: ZK Privacy Pool (Deposit -> Note -> Send) ---
          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("Send 5 USDC privately to Bob", setPhoneInput, 110);
          await sleep(400);
          if (!active) break;
          const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setPhoneMessages(prev => [...prev, { id: 1, type: 'sent', text: "Send 5 USDC privately to Bob", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          // Step 1: Deposit confirmation request
          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 2, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(1500);
          if (!active) break;

          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 3,
            type: 'received',
            text: "To send 5 USDC privately to Bob via the ZK Privacy Pool, we need to deposit it into the pool first to shield it. This will generate a ZK Secret Note.\n\nReply with *Confirm* to execute this deposit.",
            time: t
          }]);
          setBotStatus('online');
          await sleep(2500);
          if (!active) break;

          // Step 2: User confirms deposit
          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("confirm", setPhoneInput, 130);
          await sleep(400);
          if (!active) break;
          setPhoneMessages(prev => [...prev, { id: 4, type: 'sent', text: "confirm", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          // Step 3: Deposit execution (ZK proof)
          setPhoneMessages(prev => [...prev, {
            id: 5,
            type: 'received',
            text: "⏳ *Generating ZK private deposit proof...*",
            time: t
          }]);
          setBotStatus('typing...');
          await sleep(3000);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 6, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(2000);
          if (!active) break;

          // Step 4: Deposit successful, returns note & asks for withdrawal confirmation to Bob
          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 7,
            type: 'received',
            text: "🛡️ *Successfully deposited 5.00 USDC into the Privacy Pool!* 🤫\n\nSave this ZK Secret Note:\n`stellapp-zk-v1_CBNWI5VVLB5ISMXKYS2HBARIJAVR35ACZMQM6TQMMTU3AGMVRV5ZC7QL_5_f839d20c91ab772f913d80_b4e578c187a2d3e120`\n\nNow, do you want to withdraw/send this note to Bob (Address: `GD2X...`) privately?\n\nReply with *Confirm* to execute this private transfer.",
            time: t
          }]);
          setBotStatus('online');
          await sleep(3500);
          if (!active) break;

          // Step 5: User confirms withdrawal to Bob
          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("confirm", setPhoneInput, 130);
          await sleep(400);
          if (!active) break;
          setPhoneMessages(prev => [...prev, { id: 8, type: 'sent', text: "confirm", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          // Step 6: Withdrawal execution (ZK proof)
          setPhoneMessages(prev => [...prev, {
            id: 9,
            type: 'received',
            text: "⏳ *Generating ZK proof for private withdrawal to Bob...*",
            time: t
          }]);
          setBotStatus('typing...');
          await sleep(3000);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 10, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(2000);
          if (!active) break;

          // Step 7: Withdrawal success message
          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 11,
            type: 'received',
            text: "✅ *Private Transfer Completed!* 📤\n\n5.00 USDC has been withdrawn from the ZK Privacy Pool directly into Bob's wallet. The link between your deposit and Bob's withdrawal is completely broken and untraceable on-chain.\n\n🔗 Explorer: https://stellar.expert/explorer/testnet/tx/f8a2e7d8...",
            time: t
          }]);
          setBotStatus('online');

        } else if (activeTab === 3) {
          // --- Scenario 3: ZK Confidential Transfer Payment (Deposit -> Merge -> Transfer) ---
          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("Send 10 USDC confidentially to Bob", setPhoneInput, 110);
          await sleep(400);
          if (!active) break;
          const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setPhoneMessages(prev => [...prev, { id: 1, type: 'sent', text: "Send 10 USDC confidentially to Bob", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          // Step 1: Deposit confirmation request
          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 2, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(1500);
          if (!active) break;

          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 3,
            type: 'received',
            text: "To send 10 USDC confidentially to Bob, we first need to deposit 10 USDC from your public wallet into your shielded balance on-chain.\n\nReply with *Confirm* to execute this deposit.",
            time: t
          }]);
          setBotStatus('online');
          await sleep(2500);
          if (!active) break;

          // Step 2: User confirms deposit
          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("confirm", setPhoneInput, 130);
          await sleep(400);
          if (!active) break;
          setPhoneMessages(prev => [...prev, { id: 4, type: 'sent', text: "confirm", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          // Step 3: Deposit execution (ZK proof)
          setPhoneMessages(prev => [...prev, {
            id: 5,
            type: 'received',
            text: "⏳ *Depositing 10 USDC into ZK receiving balance...*",
            time: t
          }]);
          setBotStatus('typing...');
          await sleep(3000);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 6, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(2000);
          if (!active) break;

          // Step 4: Deposit successful & asks to merge
          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 7,
            type: 'received',
            text: "🛡️ *Successfully deposited 10 USDC into your confidential receiving balance!* 🤫\n\n*Note*: You must call \"merge\" to fold this receiving balance into your spendable balance before you can spend/transfer it.\n\nReply with *Merge* to proceed.",
            time: t
          }]);
          setBotStatus('online');
          await sleep(3500);
          if (!active) break;

          // Step 5: User confirms merge
          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("merge", setPhoneInput, 120);
          await sleep(400);
          if (!active) break;
          setPhoneMessages(prev => [...prev, { id: 8, type: 'sent', text: "merge", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          // Step 6: Merge execution (ZK rollup/sum update)
          setPhoneMessages(prev => [...prev, {
            id: 9,
            type: 'received',
            text: "⏳ *Merging receiving balance into spendable for USDC...*",
            time: t
          }]);
          setBotStatus('typing...');
          await sleep(2500);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 10, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(2000);
          if (!active) break;

          // Step 7: Merge successful & asks for transfer confirmation to Bob
          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 11,
            type: 'received',
            text: "Successfully folded receiving balance of USDC into your spendable balance! 🤫\n\nNow, do you want to transfer 10.00 USDC confidentially to Bob (Address: `GD2X...`) on-chain?\n\nReply with *Confirm* to execute this confidential transfer.",
            time: t
          }]);
          setBotStatus('online');
          await sleep(3500);
          if (!active) break;

          // Step 8: User confirms transfer to Bob
          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("confirm", setPhoneInput, 130);
          await sleep(400);
          if (!active) break;
          setPhoneMessages(prev => [...prev, { id: 12, type: 'sent', text: "confirm", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          // Step 9: Transfer execution (ZK range proof & ECDH encryption)
          setPhoneMessages(prev => [...prev, {
            id: 13,
            type: 'received',
            text: "⏳ *Generating ZK proof for private transfer of 10 USDC...*\n\nThis derives ephemeral ECDH keys and solves UltraHonk witnesses. It takes 15-20 seconds.",
            time: t
          }]);
          setBotStatus('typing...');
          await sleep(3000);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 14, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(2000);
          if (!active) break;

          // Step 10: Transfer success message
          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 15,
            type: 'received',
            text: "Successfully transferred 10 USDC privately! 🔒\n\nThe transaction is finalized on-chain with hidden amounts and balances.\n\nTx Hash: `ab83c7d1...`\nExplorer: https://stellar.expert/explorer/testnet/tx/ab83c7d1...",
            time: t
          }]);
          setBotStatus('online');

        } else if (activeTab === 4) {
          // --- Scenario 4: Automated Alerts & Background Jobs ---
          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("DCA 5 XLM into USDC daily", setPhoneInput, 110);
          await sleep(400);
          if (!active) break;
          const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setPhoneMessages(prev => [...prev, { id: 1, type: 'sent', text: "DCA 5 XLM into USDC daily", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 2, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(1500);
          if (!active) break;

          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 3,
            type: 'received',
            text: "I can set up an automated background job to swap 5 XLM into USDC every 24 hours.\n\nReply with *Confirm* to register this task.",
            time: t
          }]);
          setBotStatus('online');
          await sleep(2500);
          if (!active) break;

          setIsKeyboardActive(true);
          await sleep(500);
          if (!active) break;
          await typeText("confirm", setPhoneInput, 130);
          await sleep(400);
          if (!active) break;
          setPhoneMessages(prev => [...prev, { id: 4, type: 'sent', text: "confirm", time: t }]);
          setPhoneInput('Message');
          setIsKeyboardActive(false);
          await sleep(600);
          if (!active) break;

          setBotStatus('typing...');
          setPhoneMessages(prev => [...prev, { id: 5, type: 'received', text: '...', time: '', typing: true }]);
          await sleep(1500);
          if (!active) break;

          setPhoneMessages(prev => prev.filter(m => !m.typing));
          setPhoneMessages(prev => [...prev, {
            id: 6,
            type: 'received',
            text: "✅ *Automated DCA Active!* 🔄\n\nI have registered the worker task. You will receive updates here whenever the trade executes.",
            time: t
          }]);
          setBotStatus('online');
          await sleep(4000);
          if (!active) break;

          // Simulated background transfer notification event!
          setPhoneMessages(prev => [...prev, {
            id: 7,
            type: 'received',
            text: "🔔 *Background Job Alert!*\n\n• *Task:* Daily DCA Swap\n• *Execution:* 5.00 XLM ➡️ 0.62 USDC\n• *Status:* Success\n• *Tx Hash:* `e3d2f7a1...`\n\n🔗 explorer.stellar.org/tx/e3d2f7a1",
            time: t
          }]);
          setBotStatus('online');
        }

        // Wait on the final state before looping
        await sleep(8000);
      }
    };

    runLoop();

    return () => {
      active = false;
    };
  }, [activeTab]);

  return (
    <div ref={containerRef} style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Full-screen HLS Video Background */}
      <HlsVideoBackground />

      {/* Premium Hero Backgrounds */}
      <div className="mesh-bg" style={{ opacity: 0.15 }}></div>
      <div className="hero-orb hero-orb-1" style={{ opacity: 0.2 }}></div>
      <div className="hero-orb hero-orb-2" style={{ opacity: 0.2 }}></div>
 
      <header className="section hero">
          <div className="hero-left" style={{ textAlign: 'center', margin: '0 auto', maxWidth: '800px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <BlurText
                  text="Chat. Build. Pay. On Stellar."
                  delay={120}
                  animateBy="words"
                  direction="top"
                  className="hero-title"
              />              <p className="hero-desc">Send, receive, swap, deploy contracts and more — all on Stellar, all inside WhatsApp.</p>
              
              <div className="cta-group" style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
                  <a href="https://wa.me/917012751478?text=create%20wallet" target="_blank" rel="noopener noreferrer" className="primary-btn green-whatsapp-btn">
                      <img src="/dashboard/assets/logo.png" alt="Stellapp Logo" style={{ width: '18px', height: '18px', marginRight: '8px', objectFit: 'contain' }} />
                      Chat on WhatsApp
                  </a>
                  <a href="#how-it-works" className="secondary-btn play-demo-btn">
                      <div className="play-icon-circle">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z"/>
                          </svg>
                      </div>
                      See How It Works
                  </a>
              </div>
          </div>
      </header>


      <section id="features" className="section bento-features" style={{ position: 'relative' }}>
          <div className="features-bg">
              <div className="features-orb orb-1"></div>
              <div className="features-orb orb-2"></div>
              <div className="features-orb orb-3"></div>
          </div>
          
          <div className="bento-container">
              <div className="bento-header">
                  <h2>With Stellapp, crypto is <span className="highlight">simple.</span></h2>
              </div>
              <ScrollStack useWindowScroll={true} itemDistance={120} baseScale={0.88} itemScale={0.03} itemStackDistance={25} className="scroll-stack-window">
                  <ScrollStackItem itemClassName="bento-card full-width light-card">
                      <div className="bento-content">
                          <h3>Send money to your contacts across the world instantly</h3>
                          <p>Send money anywhere in the world instantly with no banks and near-zero fees. If your contacts have WhatsApp, they have Stellapp.</p>
                      </div>
                      <div className="bento-icon">
                          <svg width="130" height="130" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 10px rgba(129, 199, 132, 0.25))' }}>
                              <g clipPath="url(#globeClip)">
                                  <path 
                                      fillRule="evenodd" 
                                      clipRule="evenodd" 
                                      d="M10.27 14.1a6.5 6.5 0 0 0 3.67-3.45q-1.24.21-2.7.34-.31 1.83-.97 3.1M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m.48-1.52a7 7 0 0 1-.96 0H7.5a4 4 0 0 1-.84-1.32q-.38-.89-.63-2.08a40 40 0 0 0 3.92 0q-.25 1.2-.63 2.08a4 4 0 0 1-.84 1.31zm2.94-4.76q1.66-.15 2.95-.43a7 7 0 0 0 0-2.58q-1.3-.27-2.95-.43a18 18 0 0 1 0 3.44m-1.27-3.54a17 17 0 0 1 0 3.64 39 39 0 0 1-4.3 0 17 17 0 0 1 0-3.64 39 39 0 0 1 4.3 0m1.1-1.17q1.45.13 2.69.34a6.5 6.5 0 0 0-3.67-3.44q.65 1.26.98 3.1M8.48 1.5l.01.02q.41.37.84 1.31.38.89.63 2.08a40 40 0 0 0-3.92 0q.25-1.2.63-2.08a4 4 0 0 1 .85-1.32 7 7 0 0 1 .96 0m-2.75.4a6.5 6.5 0 0 0-3.67 3.44 29 29 0 0 1 2.7-.34q.31-1.83.97-3.1M4.58 6.28q-1.66.16-2.95.43a7 7 0 0 0 0 2.58q1.3.27 2.95.43a18 18 0 0 1 0-3.44m.17 4.71q-1.45-.12-2.69-.34a6.5 6.5 0 0 0 3.67 3.44q-.65-1.27-.98-3.1" 
                                      fill="var(--accent-1)" 
                                  />
                              </g>
                              <defs>
                                  <clipPath id="globeClip">
                                      <rect width="16" height="16" fill="white"/>
                                  </clipPath>
                              </defs>
                          </svg>
                      </div>
                  </ScrollStackItem>
                  
                  <ScrollStackItem itemClassName="bento-card full-width dark-card">
                      <div className="bento-content">
                          <h3>Crypto & DeFi, One Message Away</h3>
                          <p>Buy, sell, and hold crypto such as XLM or USDC with just a text. We manage the wallet infrastructure for you, making Web3 completely effortless.</p>
                      </div>
                      <div className="bento-icon">
                          <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 12px rgba(129, 199, 132, 0.25))' }}>
                              {/* Wallet Base */}
                              <rect x="15" y="30" width="70" height="45" rx="8" fill="var(--bg-color)" stroke="var(--accent-1)" strokeWidth="2"/>
                              
                              {/* Wallet Flap/Strap */}
                              <path d="M85 45H65C62.2386 45 60 47.2386 60 50C60 52.7614 62.2386 55 65 55H85" fill="var(--accent-2)" stroke="var(--accent-1)" strokeWidth="2"/>
                              <circle cx="72" cy="50" r="3" fill="var(--accent-1)"/>
                              
                              {/* Floating Crypto Coins */}
                              <g style={{ transform: 'translateY(-5px)' }}>
                                  {/* USDC-like coin */}
                                  <circle cx="40" cy="25" r="12" fill="#2775ca"/>
                                  <circle cx="40" cy="25" r="9" stroke="rgba(255,255,255,0.2)" strokeWidth="1"/>
                                  <path d="M38 22V28M42 22V28M37 25H43" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                                  
                                  {/* Stellar/XLM-like coin */}
                                  <circle cx="65" cy="18" r="10" fill="var(--accent-1)"/>
                                  <circle cx="65" cy="18" r="7" stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
                                  <path d="M62 16L68 20M62 20L68 16" stroke="var(--bg-color)" strokeWidth="1.5" strokeLinecap="round"/>
                              </g>
                              
                              {/* Connecting nodes/network lines */}
                              <path d="M25 45L45 45" stroke="var(--accent-3)" strokeWidth="2" strokeDasharray="4 4"/>
                              <circle cx="25" cy="45" r="2" fill="var(--accent-3)"/>
                              <circle cx="45" cy="45" r="2" fill="var(--accent-3)"/>
                          </svg>
                      </div>
                  </ScrollStackItem>
                  
                  <ScrollStackItem itemClassName="bento-card full-width light-card">
                      <div className="bento-content">
                          <h3>Deploy Smart Contracts in Chat</h3>
                          <p>Launch Soroban smart contracts directly from WhatsApp. Describe your idea, and your AI assistant will write, test, and deploy it on Stellar.</p>
                      </div>
                      <div className="bento-icon">
                          <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 8px rgba(46, 125, 50, 0.1))' }}>
                              {/* Code compilation terminal box */}
                              <rect x="15" y="20" width="70" height="60" rx="10" fill="var(--accent-2)" stroke="var(--accent-3)" strokeWidth="2"/>
                              <path d="M15 32H85" stroke="var(--accent-3)" strokeWidth="1.5"/>
                              {/* Terminal dots */}
                              <circle cx="23" cy="26" r="2.5" fill="#ef4444"/>
                              <circle cx="30" cy="26" r="2.5" fill="#eab308"/>
                              <circle cx="37" cy="26" r="2.5" fill="#22c55e"/>
                              {/* Code brackets and prompt */}
                              <path d="M26 44L34 50L26 56" stroke="var(--accent-1)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                              <rect x="39" y="53" width="14" height="3" fill="var(--accent-1)" rx="1.5">
                                  <animate attributeName="opacity" values="1;0;1" dur="1.2s" repeatCount="indefinite"/>
                              </rect>
                              {/* Floating Sparkles */}
                              <path d="M72 42L74 46L78 48L74 50L72 54L70 50L66 48L70 46L72 42Z" fill="var(--accent-1)" opacity="0.8"/>
                          </svg>
                      </div>
                  </ScrollStackItem>
                  
                  <ScrollStackItem itemClassName="bento-card full-width dark-card">
                      <div className="bento-content">
                          <h3>ZK Privacy: Pools & Confidential Transfers</h3>
                          <p>Protect your transactions with two advanced Zero-Knowledge systems. Use the ZK Privacy Pool to mix and shield tokens anonymously via secret notes, and ZK Confidential Transfers to encrypt and hide your account balances completely on-chain.</p>
                      </div>
                      <div className="bento-icon">
                          <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 12px rgba(129, 199, 132, 0.25))' }}>
                              {/* Shield outline */}
                              <path d="M50 15C50 15 25 22 25 45C25 65 50 85 50 85C50 85 75 65 75 45C75 22 50 15 50 15Z" fill="var(--bg-color)" stroke="var(--accent-1)" strokeWidth="2.5" strokeLinejoin="round"/>
                              {/* Glowing central lock */}
                              <rect x="42" y="47" width="16" height="14" rx="3" fill="var(--accent-2)" stroke="var(--accent-1)" strokeWidth="1.5"/>
                              <path d="M45 47V40C45 37.2386 47.2386 35 50 35C52.7614 35 55 37.2386 55 40V47" stroke="var(--accent-1)" strokeWidth="1.5" strokeLinecap="round"/>
                              {/* ZK Nodes/Math connection lines */}
                              <path d="M15 25L25 35" stroke="var(--accent-3)" strokeWidth="1.5" strokeDasharray="3 3"/>
                              <path d="M85 25L75 35" stroke="var(--accent-3)" strokeWidth="1.5" strokeDasharray="3 3"/>
                              <path d="M50 85V95" stroke="var(--accent-3)" strokeWidth="1.5" strokeDasharray="3 3"/>
                              <circle cx="15" cy="25" r="3.5" fill="var(--accent-3)"/>
                              <circle cx="85" cy="25" r="3.5" fill="var(--accent-3)"/>
                              <circle cx="50" cy="95" r="3.5" fill="var(--accent-3)"/>
                              <path d="M22 62C22 62 30 75 50 80" stroke="var(--accent-1)" strokeWidth="1.5" strokeDasharray="2 2"/>
                          </svg>
                      </div>
                  </ScrollStackItem>
                  
                  <ScrollStackItem itemClassName="bento-card full-width light-card">
                      <div className="bento-content">
                          <h3>Automated Alerts & Background Jobs</h3>
                          <p>From scheduled payments to price and balance alerts, instant transaction receipts, and automatic private-balance syncing — StellApp handles it all in the background, so your wallet stays current without you lifting a finger.</p>
                      </div>
                      <div className="bento-icon">
                          <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 0 8px rgba(46, 125, 50, 0.1))' }}>
                              {/* Background gear */}
                              <circle cx="50" cy="50" r="30" fill="var(--accent-2)" stroke="var(--accent-3)" strokeWidth="2" strokeDasharray="3 3"/>
                              {/* Outer Clock circle */}
                              <circle cx="50" cy="50" r="22" stroke="var(--accent-1)" strokeWidth="2.5"/>
                              {/* Clock Hands */}
                              <path d="M50 34V50H62" stroke="var(--accent-1)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                              {/* Alert Bell / Notification badge */}
                              <circle cx="72" cy="28" r="8" fill="#eab308" stroke="var(--bg-color)" strokeWidth="1.5"/>
                              {/* Exclamation point inside alert */}
                              <path d="M72 25V29M72 31H72.01" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                              {/* Tiny rotating stars/sparks around the gear */}
                              <path d="M22 30L24 34L28 36L24 38L22 42L20 38L16 36L20 34L22 30Z" fill="var(--accent-3)" opacity="0.6"/>
                          </svg>
                      </div>
                  </ScrollStackItem>
              </ScrollStack>
          </div>
      </section>

      <section id="how-it-works" className="section how-it-works-section">
          <h2 className="how-it-works-title">Features in Action.</h2>
          <p className="how-it-works-desc">Select a feature to see how Stellapp handles it live inside WhatsApp.</p>
          
          <div className="how-it-works-container">
              {/* Left Column: Feature details panel */}
              <div className="interactive-info-panel" key={activeTab}>
                  <div className="interactive-info-num">{featuresData[activeTab].num}</div>
                  <h3 className="interactive-info-title">{featuresData[activeTab].title}</h3>
                  <p className="interactive-info-desc">{featuresData[activeTab].desc}</p>
                  <div className="interactive-info-benefits">
                      {featuresData[activeTab].benefits.map((b, idx) => (
                          <div key={idx} className="benefit-item">
                              <span className="benefit-tick">✓</span>
                              <span>{b}</span>
                          </div>
                      ))}
                  </div>
              </div>

              {/* Center Column: Interactive selector tab buttons */}
              <div className="interactive-tab-stack">
                  {[
                      { text: "Sending Tokens", num: "01" },
                      { text: "Deploy Contracts", num: "02" },
                      { text: "ZK Privacy Pool", num: "03" },
                      { text: "Confidential Transfer", num: "04" },
                      { text: "Automated Alerts", num: "05" }
                  ].map((tab, index) => (
                      <button
                          key={index}
                          className={`tab-button ${activeTab === index ? 'active' : ''}`}
                          onClick={() => setActiveTab(index)}
                      >
                          <span className="tab-button-num">{tab.num}</span>
                          <span className="tab-button-text">{tab.text}</span>
                      </button>
                  ))}
              </div>

              {/* Right Column: Phone chat visual mockup */}
              <div className="phone-mockup-wrapper">
                  <div className="phone-container" style={{ transform: 'none', animation: 'none' }}>
                      <div className="phone-button silent"></div>
                      <div className="phone-button volume-up"></div>
                      <div className="phone-button volume-down"></div>
                      <div className="phone-button power"></div>
                      
                      <div className="phone-mockup">
                          {/* iOS Status Bar */}
                          <div className="phone-status-bar">
                              <span className="status-time">{liveTime}</span>
                              <div className="status-icons">
                                  {/* 4-bar cellular signal — matches screenshot dot-bar style */}
                                  <svg width="18" height="13" viewBox="0 0 18 13" fill="white" style={{ marginRight: '1px' }}>
                                      <rect x="0"   y="9"   width="3" height="4"  rx="0.8"/>
                                      <rect x="5"   y="6.5" width="3" height="6.5" rx="0.8"/>
                                      <rect x="10"  y="3.5" width="3" height="9.5" rx="0.8"/>
                                      <rect x="15"  y="0"   width="3" height="13" rx="0.8" opacity="0.3"/>
                                  </svg>
                                  {/* WiFi — 3 arcs + dot matching screenshot */}
                                  <svg width="15" height="12" viewBox="0 0 24 18" fill="none" stroke="white" strokeLinecap="round" strokeLinejoin="round">
                                      <path strokeWidth="2.5" d="M1 7.5C5.5 3 18.5 3 23 7.5" opacity="0.3"/>
                                      <path strokeWidth="2.5" d="M4.5 11C8 7.5 16 7.5 19.5 11"/>
                                      <path strokeWidth="2.5" d="M8.5 14.5c1.9-1.8 5.1-1.8 7 0"/>
                                      <circle cx="12" cy="17.5" r="1.8" fill="white" stroke="none"/>
                                  </svg>
                                  {/* Battery: percentage number + outline icon, matching screenshot */}
                                  <div className="status-battery-wrap">
                                      <div className="battery-icon">
                                          <div className="battery-body">
                                              <div className="battery-level"></div>
                                          </div>
                                          <div className="battery-nub"></div>
                                      </div>
                                  </div>
                              </div>
                          </div>

                          <div className="phone-notch">
                              <div className="camera-lens"></div>
                          </div>
                          
                          <div className="phone-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '38px 12px 10px 8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  {/* Back chevron */}
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00a884" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: 'pointer', marginRight: '2px' }}>
                                      <polyline points="15 18 9 12 15 6"></polyline>
                                  </svg>
                                  {/* Avatar / Profile picture */}
                                  <div className="avatar" style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#1f2c34', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginRight: '2px' }}>
                                      <img src="/dashboard/assets/logo.png" alt="Stellapp DP" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  </div>
                                  <div>
                                      <div className="contact-name" style={{ fontSize: '13.5px', fontWeight: 600, color: '#e9edef', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                          Stellapp 
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="#00a884" style={{ display: 'inline-block' }}>
                                              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                          </svg>
                                      </div>
                                      <div style={{ fontSize: '10px', color: botStatus === 'typing...' ? '#00a884' : '#a0aab5', fontWeight: 500, transition: 'color 0.3s', marginTop: '-1px' }}>
                                          {botStatus}
                                      </div>
                                  </div>
                              </div>
                              
                              {/* Right call actions */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', paddingRight: '4px' }}>
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00a884" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: 'pointer' }}>
                                      <path d="M23 7a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V7Z" />
                                      <path d="M23 12h-4" />
                                  </svg>
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00a884" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: 'pointer' }}>
                                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                                  </svg>
                              </div>
                          </div>
                          
                          <div className="phone-body" ref={phoneBodyRef} style={{ overflowY: 'auto' }}>
                              {phoneMessages.map((msg) => (
                                  <div key={msg.id} className={`message ${msg.type}`}>
                                      {msg.typing ? (
                                          <div className="typing-indicator" style={{ display: 'flex', gap: '4px', padding: '4px 0' }}>
                                              <span className="dot" style={{ width: '6px', height: '6px', background: '#e9edef', borderRadius: '50%', display: 'inline-block', animation: 'bounce 1.3s infinite ease-in-out' }}></span>
                                              <span className="dot" style={{ width: '6px', height: '6px', background: '#e9edef', borderRadius: '50%', display: 'inline-block', animation: 'bounce 1.3s infinite ease-in-out', animationDelay: '0.2s' }}></span>
                                              <span className="dot" style={{ width: '6px', height: '6px', background: '#e9edef', borderRadius: '50%', display: 'inline-block', animation: 'bounce 1.3s infinite ease-in-out', animationDelay: '0.4s' }}></span>
                                          </div>
                                      ) : (
                                          <span style={{ whiteSpace: 'pre-wrap' }}>
                                              {msg.text}
                                          </span>
                                      )}
                                      {!msg.typing && (
                                          <div className="msg-time">
                                              {msg.time}
                                              {msg.type === 'sent' && <span className="msg-check" style={{ color: '#53bdeb', marginLeft: '4px' }}>✓✓</span>}
                                          </div>
                                      )}
                                  </div>
                              ))}
                          </div>
                          
                          <div className="phone-footer" style={{ padding: '6px 8px 24px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {/* Plus attachment icon */}
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00a884" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: 'pointer', flexShrink: 0 }}>
                                  <line x1="12" y1="5" x2="12" y2="19"></line>
                                  <line x1="5" y1="12" x2="19" y2="12"></line>
                              </svg>

                              {/* Input bar */}
                              <div className="input-bar" style={{ flex: 1, padding: '7px 12px', height: '34px', background: '#2a3942', borderRadius: '18px' }}>
                                  <span style={{ color: phoneInput === 'Message' ? '#8596a0' : '#e9edef', fontSize: '13.5px' }}>
                                      {phoneInput}
                                  </span>
                                  <span style={{ fontSize: '15px', color: '#8596a0' }}>📷</span>
                              </div>

                              {/* Mic/Send button depends on keyboard input status */}
                              {isKeyboardActive ? (
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#00a884', cursor: 'pointer', flexShrink: 0, padding: '1px' }}>
                                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                                  </svg>
                              ) : (
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00a884" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: 'pointer', flexShrink: 0 }}>
                                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                      <line x1="12" y1="19" x2="12" y2="23"></line>
                                      <line x1="8" y1="23" x2="16" y2="23"></line>
                                  </svg>
                              )}
                          </div>
                          
                          <div className={`phone-keyboard ${isKeyboardActive ? 'active' : ''}`}>
                               {keyboardMode === 'numeric' ? (
                                   /* Numeric keypad layout */
                                   <>
                                       <div className="key-row">
                                           {['1','2','3'].map(k => (
                                               <div key={k} className={`key${activeKey === k ? ' key-pressed' : ''}`}>{k}</div>
                                           ))}
                                       </div>
                                       <div className="key-row">
                                           {['4','5','6'].map(k => (
                                               <div key={k} className={`key${activeKey === k ? ' key-pressed' : ''}`}>{k}</div>
                                           ))}
                                       </div>
                                       <div className="key-row">
                                           {['7','8','9'].map(k => (
                                               <div key={k} className={`key${activeKey === k ? ' key-pressed' : ''}`}>{k}</div>
                                           ))}
                                       </div>
                                       <div className="key-row">
                                           <div className="key wide" style={{ fontSize: '11px' }}>ABC</div>
                                           <div className={`key${activeKey === '0' ? ' key-pressed' : ''}`}>0</div>
                                           <div className={`key wide${activeKey === 'BACKSPACE' ? ' key-pressed' : ''}`}>⌫</div>
                                       </div>
                                   </>
                               ) : (
                                   /* QWERTY alpha layout */
                                   <>
                                       <div className="key-row">
                                           {['Q','W','E','R','T','Y','U','I','O','P'].map(k => (
                                               <div key={k} className={`key${activeKey === k ? ' key-pressed' : ''}`}>{k}</div>
                                           ))}
                                       </div>
                                       <div className="key-row" style={{ padding: '0 8px' }}>
                                           {['A','S','D','F','G','H','J','K','L'].map(k => (
                                               <div key={k} className={`key${activeKey === k ? ' key-pressed' : ''}`}>{k}</div>
                                           ))}
                                       </div>
                                       <div className="key-row">
                                           <div className="key wide">⬆</div>
                                           {['Z','X','C','V','B','N','M'].map(k => (
                                               <div key={k} className={`key${activeKey === k ? ' key-pressed' : ''}`}>{k}</div>
                                           ))}
                                           <div className={`key wide${activeKey === 'BACKSPACE' ? ' key-pressed' : ''}`}>⌫</div>
                                       </div>
                                       <div className="key-row">
                                           <div className="key wide" style={{ fontSize: '11px' }}>123</div>
                                           <div className={`key space${activeKey === ' ' ? ' key-pressed' : ''}`}>space</div>
                                           <div className="key wide" style={{ background: 'var(--accent-1)', color: '#000', fontWeight: 'bold', fontSize: '12px' }}>Send</div>
                                       </div>
                                   </>
                               )}
                           </div>
                      </div>
                  </div>
              </div>
          </div>
      </section>

      <section id="privacy-comparison" className="section privacy-comparison-section">
          <h2 className="comparison-title">Ledger Visibility.</h2>
          <p className="comparison-desc">Standard Stellar transactions are fully public — everyone can see sender, receiver, and amount. Stellar&apos;s network natively supports two levels of privacy. Stellapp gives you a simple WhatsApp interface to access them.</p>
          
          <div className="comparison-container">

              {/* Card 1 — Standard Transfer */}
              <div className="comparison-card public">
                  <h3>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                          <circle cx="12" cy="12" r="10"></circle>
                          <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                      Standard Transfer
                  </h3>
                  <p className="intro">Every detail is publicly visible on the Stellar block explorer. Anyone can trace sender, receiver, amount, and timing.</p>
                  
                  <div className="ledger-receipt">
                      <div className="receipt-row">
                          <span className="receipt-label">SENDER</span>
                          <span className="receipt-val" style={{ color: '#ef4444' }}>GC5A...3P2L ⚠</span>
                      </div>
                      <div className="receipt-row">
                          <span className="receipt-label">RECIPIENT</span>
                          <span className="receipt-val" style={{ color: '#ef4444' }}>GD4S...7W1R ⚠</span>
                      </div>
                      <div className="receipt-row">
                          <span className="receipt-label">AMOUNT</span>
                          <span className="receipt-val" style={{ color: '#ef4444' }}>100.00 USDC ⚠</span>
                      </div>
                      <div className="receipt-row">
                          <span className="receipt-label">MEMO</span>
                          <span className="receipt-val" style={{ color: '#ef4444' }}>Visible ⚠</span>
                      </div>
                      <div className="receipt-row">
                          <span className="receipt-label">STATUS</span>
                          <span className="status-badge public">🟠 FULLY PUBLIC</span>
                      </div>
                  </div>
              </div>

              {/* Card 2 — ZK Privacy Pool */}
              <div className="comparison-card private" style={{ borderColor: '#7c3aed44', background: 'linear-gradient(135deg, rgba(124,58,237,0.06) 0%, rgba(0,0,0,0) 100%)' }}>
                  <h3 style={{ color: '#a78bfa' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" style={{ marginRight: '8px' }}>
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                      </svg>
                      ZK Privacy Pool
                  </h3>
                  <p className="intro">Deposit into a shared anonymity pool. Withdraw using a secret note — sender and receiver are completely unlinkable.</p>
                  
                  <div className="ledger-receipt">
                      <div className="receipt-row">
                          <span className="receipt-label">SENDER</span>
                          <span className="receipt-val" style={{ color: '#a78bfa' }}>🔒 Pool Contract</span>
                      </div>
                      <div className="receipt-row">
                          <span className="receipt-label">RECIPIENT</span>
                          <span className="receipt-val" style={{ color: '#a78bfa' }}>🔒 Anonymous Note</span>
                      </div>
                      <div className="receipt-row">
                          <span className="receipt-label">AMOUNT</span>
                          <span className="receipt-val" style={{ color: '#a78bfa' }}>🔒 Hidden in Pool</span>
                      </div>
                      <div className="receipt-row">
                          <span className="receipt-label">PROOF</span>
                          <span className="receipt-val" style={{ color: '#a78bfa', fontSize: '10px' }}>zk-SNARK Verified ✓</span>
                      </div>
                      <div className="receipt-row">
                          <span className="receipt-label">STATUS</span>
                          <span className="status-badge private" style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid #7c3aed55' }}>🛡 UNTRACEABLE</span>
                      </div>
                  </div>
              </div>

              {/* Card 3 — Confidential Transfer */}
              <div className="comparison-card private">
                  <h3>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                      </svg>
                      Confidential Transfer
                  </h3>
                  <p className="intro">Addresses are visible but the amount is fully encrypted on-chain. ZK range proofs verify solvency without revealing the balance.</p>
                  
                  <div className="ledger-receipt">
                      <div className="receipt-row">
                          <span className="receipt-label">SENDER</span>
                          <span className="receipt-val">GD2X...8KF2</span>
                      </div>
                      <div className="receipt-row">
                          <span className="receipt-label">RECIPIENT</span>
                          <span className="receipt-val">GB9P...3QW1</span>
                      </div>
                      <div className="receipt-row">
                          <span className="receipt-label">AMOUNT</span>
                          <span className="receipt-val" style={{ color: '#00a884' }}>🔒 Encrypted Ciphertext</span>
                      </div>
                      <div className="receipt-row">
                          <span className="receipt-label">BALANCE</span>
                          <span className="receipt-val" style={{ color: '#00a884' }}>🔒 Shielded On-Chain</span>
                      </div>
                      <div className="receipt-row">
                          <span className="receipt-label">STATUS</span>
                          <span className="status-badge private">🛡️ AMOUNT HIDDEN</span>
                      </div>
                  </div>
              </div>

          </div>
      </section>

      <section id="faq" className="section faq-section">
          <h2 className="faq-title" style={{ fontFamily: 'var(--font-serif)', fontSize: '38px', textAlign: 'center', marginBottom: '8px' }}>Frequently asked questions</h2>
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: '40px', fontSize: '16px' }}>Everything you need to know about secure payments, private transfers, and smart accounts with Stellapp.</p>
          <div className="faq-container">
              <div className="faq-item">
                  <button className="faq-question" onClick={toggleFaq}>
                      Is my crypto safe on WhatsApp?
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="faq-icon">
                          <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                  </button>
                  <div className="faq-answer">
                      <p>Yes. Stellapp provides a secure, fully-managed custodial wallet. We handle all the complex key management on our enterprise-grade backend. WhatsApp acts as a fast, authenticated channel to communicate your intents to our AI, executing your transactions safely and instantly.</p>
                  </div>
              </div>
              <div className="faq-item">
                  <button className="faq-question" onClick={toggleFaq}>
                      What are the fees?
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="faq-icon">
                          <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                  </button>
                  <div className="faq-answer">
                      <p>Stellapp is built on the Stellar network, meaning transactions cost a fraction of a cent. We charge zero additional fees for standard transfers and swaps.</p>
                  </div>
              </div>
              <div className="faq-item">
                  <button className="faq-question" onClick={toggleFaq}>
                      Can I really deploy smart contracts from chat?
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="faq-icon">
                          <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                  </button>
                  <div className="faq-answer">
                      <p>Absolutely. Our AI agent translates your natural language requirements into Rust code, compiles it for Soroban, and guides you through the deployment process—all within your WhatsApp chat.</p>
                  </div>
              </div>
              <div className="faq-item">
                  <button className="faq-question" onClick={toggleFaq}>
                      Which assets are supported?
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="faq-icon">
                          <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                  </button>
                  <div className="faq-answer">
                      <p>We support all native Stellar assets including XLM, USDC, EURC, and AQUA.</p>
                  </div>
              </div>
          </div>
      </section>


      <footer style={{
          background: '#070a0d',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          padding: '80px 24px 40px',
          color: 'var(--text-secondary)'
      }}>
          <div className="footer-container" style={{
              maxWidth: '1200px',
              margin: '0 auto',
              display: 'grid',
              gridTemplateColumns: '1.5fr 1fr 1fr 1fr',
              gap: '60px'
          }}>
              {/* Brand Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{
                          fontFamily: 'var(--font-serif)',
                          fontSize: '26px',
                          fontWeight: 700,
                          color: '#ffffff',
                          letterSpacing: '-0.5px'
                      }}>
                          Stellapp
                      </span>
                  </div>
                  <p style={{ fontSize: '15px', lineHeight: '1.6', color: 'var(--text-secondary)', maxWidth: '320px' }}>
                      WhatsApp-native Stellar privacy wallet. Send private payments, manage anonymity pools, and schedule automated recurring billing securely with natural language AI.
                  </p>
              </div>

              {/* Product Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h4 style={{ color: '#ffffff', fontSize: '15px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>Product</h4>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '15px' }}>
                      <li><a href="#features" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }} className="footer-link">Showcase</a></li>
                      <li><a href="/dashboard/roadmap" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }} className="footer-link">Roadmap</a></li>
                      <li><a href="https://wa.me/917012751478?text=create%20wallet" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }} className="footer-link">Get Started</a></li>
                  </ul>
              </div>

              {/* Use Cases Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h4 style={{ color: '#ffffff', fontSize: '15px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>Use Cases</h4>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '15px' }}>
                      <li><a href="#features" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }} className="footer-link">ZK Privacy Pools</a></li>
                      <li><a href="#features" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }} className="footer-link">Shielded Transfers</a></li>
                      <li><a href="#features" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }} className="footer-link">Automated Billing</a></li>
                  </ul>
              </div>

              {/* Resources Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h4 style={{ color: '#ffffff', fontSize: '15px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>Resources</h4>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '15px' }}>
                      <li><a href="https://x.com/stellapp_chat" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }} className="footer-link">X (formerly Twitter)</a></li>
                      <li><a href="https://github.com/Shijas786/stellapp" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }} className="footer-link">GitHub</a></li>
                      <li><a href="#faq" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }} className="footer-link">FAQ</a></li>
                  </ul>
              </div>
          </div>
          <div style={{
              maxWidth: '1200px',
              margin: '20px auto 0',
              paddingTop: '30px',
              borderTop: '1px solid rgba(255,255,255,0.05)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '14px',
              color: '#606a75'
          }}>
              <p>© {new Date().getFullYear()} Stellapp. All rights reserved.</p>
              <p>Built for the Stellar & ZK Privacy ecosystems.</p>
          </div>
      </footer>
    </div>
  );
}
