// Wait for DOM
document.addEventListener("DOMContentLoaded", () => {
    
    // Register GSAP plugins
    gsap.registerPlugin(ScrollTrigger);

    /* =========================================================================
       1. Hero Text Reveal Animation
       ========================================================================= */
    const heroTitle = document.querySelector(".hero h1");
    if (heroTitle) {
        // Split text into lines/words for staggering
        // We'll do a simple split by space to keep it lightweight without a library
        const text = heroTitle.innerHTML;
        const splitText = text.split(/(<br\/>|<span[^>]*>|<\/span>|\s+)/).filter(Boolean);
        
        heroTitle.innerHTML = "";
        splitText.forEach(part => {
            if (part.startsWith("<")) {
                heroTitle.innerHTML += part; // Keep HTML tags intact
            } else if (part.trim() !== "") {
                const span = document.createElement("span");
                span.innerHTML = part + " ";
                heroTitle.appendChild(span);
            } else {
                heroTitle.innerHTML += " ";
            }
        });

        // Animate the spans
        gsap.from(".hero h1 span", {
            y: 50,
            opacity: 0,
            duration: 1,
            stagger: 0.1,
            ease: "back.out(1.7)",
            delay: 0.2
        });
    }

    gsap.from(".hero p", {
        y: 30,
        opacity: 0,
        duration: 1,
        ease: "power3.out",
        delay: 0.8
    });

    gsap.from(".cta-group .primary-btn, .cta-group .secondary-btn", {
        y: 20,
        opacity: 0,
        duration: 0.8,
        stagger: 0.2,
        ease: "power2.out",
        delay: 1.2
    });


    /* =========================================================================
       2. Scroll-Triggered Bento Cards
       ========================================================================= */
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

    gsap.utils.toArray(".bento-card").forEach((card, index) => {
        // Card entrance animation
        gsap.from(card, {
            scrollTrigger: {
                trigger: card,
                start: "top 75%",
                toggleActions: "play none none reverse"
            },
            y: 40,
            opacity: 0,
            duration: 0.8,
            ease: "power3.out",
            delay: index * 0.1
        });
    });


    /* =========================================================================
       3. Magnetic Buttons (Navbar)
       ========================================================================= */
    const magneticWraps = document.querySelectorAll(".magnetic-wrap");
    
    magneticWraps.forEach(wrap => {
        const btn = wrap.querySelector(".nav-btn");
        
        wrap.addEventListener("mousemove", (e) => {
            const rect = wrap.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            
            // Move button slightly towards cursor
            gsap.to(btn, {
                x: x * 0.4,
                y: y * 0.4,
                duration: 0.3,
                ease: "power2.out"
            });
        });

        wrap.addEventListener("mouseleave", () => {
            // Snap back to center
            gsap.to(btn, {
                x: 0,
                y: 0,
                duration: 0.7,
                ease: "elastic.out(1, 0.3)"
            });
        });
    });


    /* =========================================================================
       4. Dynamic Mouse-Follow Background Blobs
       ========================================================================= */
    const blob1 = document.querySelector(".blob-1");
    const blob3 = document.querySelector(".blob-3");
    
    window.addEventListener("mousemove", (e) => {
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;

        // Subtle parallax movement
        gsap.to(blob1, {
            x: x * 50,
            y: y * 50,
            duration: 2,
            ease: "power2.out"
        });

        gsap.to(blob3, {
            x: -x * 60,
            y: -y * 60,
            duration: 3,
            ease: "power2.out"
        });
    });


    /* =========================================================================
       5. Scroll-Triggered FAQ
       ========================================================================= */
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

    gsap.utils.toArray(".faq-item").forEach((item, index) => {
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

    /* =========================================================================
       6. Navbar Scroll Blur Effect
       ========================================================================= */
    const navbar = document.querySelector(".navbar");
    window.addEventListener("scroll", () => {
        if (window.scrollY > 50) {
            navbar.style.background = "rgba(12, 13, 16, 0.8)";
            navbar.style.boxShadow = "0 4px 30px rgba(0, 0, 0, 0.5)";
        } else {
            navbar.style.background = "transparent";
            navbar.style.boxShadow = "none";
        }
    });
});
