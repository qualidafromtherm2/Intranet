document.addEventListener('DOMContentLoaded', function() {
  const slider = document.querySelector('.power-slider');
  const indicators = document.querySelectorAll('.power-indicator');
  const displayTitle = document.querySelector('.power-display-title');
  const displayDescription = document.querySelector('.power-description');
  const particles = document.querySelector('.particles');
  const powers = [
    {
      name: "Superhuman Strength",
      description: "The ability to lift mountains and protect the innocent with titanic strength.",
      color: "#FF6B6B"
    },
    {
      name: "Super Speed",
      description: "Lightning-fast speed, surpassing the limits of possibility to save others in an instant.",
      color: "#4ECDC4"
    },
    {
      name: "Supreme Intelligence",
      description: "Unlimited intellectual capacity to solve the most complex challenges.",
      color: "#45B7D1"
    },
    {
      name: "Supersonic Flight",
      description: "Absolute freedom to soar through the skies, dominating the air with grace and power.",
      color: "#96C93D"
    },
    {
      name: "Total Invisibility",
      description: "The gift of disappearing at will, perfect for secret missions and discreet protection.",
      color: "#A569BD"
    },
    {
      name: "Absolute Telepathy",
      description: "The power to read minds and communicate through thoughts across the world.",
      color: "#FF6B6B"
    },
    {
      name: "Miracle Healing",
      description: "The precious gift of healing any wound and restoring life itself.",
      color: "#4ECDC4"
    }
  ];

  function updateAriaStates(index) {
    indicators.forEach((indicator, i) => {
      indicator.setAttribute('aria-pressed', i === index ? 'true' : 'false');
    });
  }

  function handleKeyPress(event, index) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      slider.value = index;
      updatePower(index);
    }
  }

  function createParticle(x, y, color) {
    const particle = document.createElement('div');
    particle.style.position = 'absolute';
    particle.style.width = '10px';
    particle.style.height = '10px';
    particle.style.backgroundColor = color;
    particle.style.borderRadius = '50%';
    particle.style.left = x + 'px';
    particle.style.top = y + 'px';
    particle.setAttribute('aria-hidden', 'true');
    particles.appendChild(particle);
    gsap.to(particle, {
      x: (Math.random() - 0.5) * 200,
      y: (Math.random() - 0.5) * 200,
      opacity: 0,
      duration: 1.5,
      ease: "power2.out",
      onComplete: () => particle.remove()
    });
  }

  function updatePower(index) {
    const power = powers[index];
    indicators.forEach((indicator, i) => {
      indicator.classList.toggle('active', i === index);
    });
    updateAriaStates(index);
    gsap.to(displayTitle, {
      opacity: 0,
      y: -20,
      duration: 0.2,
      onComplete: () => {
        displayTitle.textContent = power.name;
        gsap.to(displayTitle, {
          opacity: 1,
          y: 0,
          duration: 0.3
        });
      }
    });
    gsap.to(displayDescription, {
      opacity: 0,
      y: -10,
      duration: 0.2,
      onComplete: () => {
        displayDescription.textContent = power.description;
        gsap.to(displayDescription, {
          opacity: 1,
          y: 0,
          duration: 0.3
        });
      }
    });
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', 'polite');
    announcement.className = 'sr-only';
    announcement.textContent = `Selected power: ${power.name}. ${power.description}`;
    document.body.appendChild(announcement);
    setTimeout(() => announcement.remove(), 1000);
    const rect = slider.getBoundingClientRect();
    const x = rect.left + (rect.width * (index / 6));
    const y = rect.top;
    for (let i = 0; i < 15; i++) {
      setTimeout(() => {
        createParticle(x, y, power.color);
      }, i * 50);
    }
  }

  slider.addEventListener('input', (e) => {
    updatePower(parseInt(e.target.value));
  });
  indicators.forEach((indicator, index) => {
    indicator.addEventListener('click', () => {
      slider.value = index;
      updatePower(index);
    });
    indicator.addEventListener('keydown', (e) => handleKeyPress(e, index));
  });

  updatePower(0);
  updateAriaStates(0);
});
